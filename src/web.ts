import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import AdmZip from 'adm-zip';
import { getDB, initSchema, initCorpusFTS, initActivityLog, initAnnotationsTable } from './db/index.js';
import { LogbookSchema, CorpusSchema, AnnotationSchema } from './schema.js';
import { AgentMemorySchema } from './schemas/AgentMemory.js';
import multer from 'multer';
import { IngestionService, stripInlineMarkup } from './ingestion.js';
import { randomUUID } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer, handleToolCall, pushAnnotationsBackground } from './mcp-server.js';
import { SyncCoordinator } from './core/SyncCoordinator.js';
import { SupabaseTransport } from './core/SupabaseTransport.js';
import { config } from 'dotenv';
config(); // load .env so SUPABASE_URL / SUPABASE_KEY are available at startup

// Initialize DB and create tables on startup
const db = getDB();
initSchema(db, LogbookSchema);
initSchema(db, AgentMemorySchema);
initSchema(db, CorpusSchema);
initCorpusFTS(db);
initActivityLog(db);
initAnnotationsTable(db, AnnotationSchema);
db.close();

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

app.post('/api/upload', upload.array('files'), async (req: any, res: any) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const results = [];
    for (const file of req.files) {
      const result = await IngestionService.ingestFile(file, req.body);
      results.push(result);
    }
    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Corpus documents
// ---------------------------------------------------------------------------

app.get('/api/documents', (_req, res: any) => {
  try {
    const docs = IngestionService.listDocuments();
    res.json(docs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/documents/:id', (req: any, res: any) => {
  try {
    const db = getDB();
    try {
      const doc = db.prepare('SELECT * FROM corpus_documents WHERE id = ?').get(req.params.id);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      res.json(doc);
    } finally {
      db.close();
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/documents/:id', (req: any, res: any) => {
  try {
    const db = getDB();
    try {
      const updates: string[] = [];
      const params: unknown[] = [];
      const now = Date.now();
      const { tags, title, author, publication_date } = req.body ?? {};

      if (tags !== undefined) {
        if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
        updates.push('tags = ?'); params.push(JSON.stringify(tags));
      }
      if (title !== undefined) { updates.push('title = ?'); params.push(title); }
      if (author !== undefined) { updates.push('author = ?'); params.push(author); }
      if (publication_date !== undefined) { updates.push('publication_date = ?'); params.push(publication_date); }

      if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

      updates.push('updated_at = ?');
      updates.push('is_dirty = 1');
      params.push(now, req.params.id);

      const result = db.prepare(
        `UPDATE corpus_documents SET ${updates.join(', ')} WHERE id = ?`
      ).run(...params);
      if (result.changes === 0) return res.status(404).json({ error: 'Document not found' });
      res.json({ success: true });
    } finally {
      db.close();
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/documents/:id', (req: any, res: any) => {
  try {
    const db = getDB();
    try {
      const result = db.prepare('DELETE FROM corpus_documents WHERE id = ?').run(req.params.id);
      if (result.changes === 0) return res.status(404).json({ error: 'Document not found' });
      res.json({ success: true });
    } finally {
      db.close();
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/corpus', (_req, res: any) => {
  try {
    const db = getDB();
    try {
      const anns = db.prepare('DELETE FROM corpus_annotations').run();
      const docs = db.prepare('DELETE FROM corpus_documents').run();
      res.json({ deleted_documents: docs.changes, deleted_annotations: anns.changes });
    } finally {
      db.close();
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Full-text search (FTS5 with LIKE fallback)
// ---------------------------------------------------------------------------

app.get('/api/search', (req: any, res: any) => {
  const query = String(req.query.q ?? '').trim();
  if (!query) return res.json([]);

  const db = getDB();
  try {
    let rows: unknown[];
    try {
      rows = db.prepare(`
        SELECT cd.id, cd.title, cd.author, cd.publication_date, cd.tags,
          snippet(corpus_fts, 2, '**', '**', '…', 32) AS snippet
        FROM corpus_fts
        JOIN corpus_documents cd ON corpus_fts.rowid = cd.rowid
        WHERE corpus_fts MATCH ?
        ORDER BY rank
        LIMIT 20
      `).all(query);
    } catch {
      // Fallback for invalid FTS5 syntax
      const pattern = `%${query}%`;
      rows = db.prepare(`
        SELECT id, title, author, publication_date, tags,
          substr(content, 1, 300) AS snippet
        FROM corpus_documents
        WHERE title LIKE ? OR content LIKE ? OR author LIKE ?
        LIMIT 20
      `).all(pattern, pattern, pattern);
    }
    // Also search annotations for tag/passage/note matches
    const annPattern = `%${query}%`;
    const annRows = db.prepare(`
      SELECT cd.id, cd.title, cd.author, cd.publication_date, cd.tags,
             ca.source_passage AS snippet
      FROM corpus_annotations ca
      JOIN corpus_documents cd ON ca.document_id = cd.id
      WHERE (ca.tag LIKE ? OR ca.source_passage LIKE ? OR ca.text LIKE ?)
        AND ca.author_type = 'human' AND ca.source_passage IS NOT NULL
      LIMIT 20
    `).all(annPattern, annPattern, annPattern) as Record<string, unknown>[];

    // Merge: doc results take priority; annotation-only matches added with from_annotation flag
    const seen = new Set((rows as Record<string, unknown>[]).map(r => r.id));
    const merged: Record<string, unknown>[] = [...rows as Record<string, unknown>[]];
    for (const ar of annRows) {
      if (!seen.has(ar.id)) {
        merged.push({ ...ar, from_annotation: true });
        seen.add(ar.id as string);
      }
    }
    res.json(merged);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// Activity log — reads from SQLite so MCP tool calls from the stdio process
// are visible here in real time (WAL mode allows concurrent readers).
// ---------------------------------------------------------------------------

app.get('/api/activity', (_req, res: any) => {
  try {
    const db = getDB();
    try {
      const rows = db.prepare(
        'SELECT * FROM mcp_activity ORDER BY timestamp DESC LIMIT 30'
      ).all();
      res.json(rows);
    } finally {
      db.close();
    }
  } catch {
    res.json([]);
  }
});

// ---------------------------------------------------------------------------
// Annotation REST API — researcher-facing CRUD
// Author type is always 'human' here; LLM writes go through MCP tools.
// Append-only: no PUT. Corrections create a new row with corrects_id.
// ---------------------------------------------------------------------------

/** Adds `tag` to the document's tags array if not already present (additive only). */
function propagateTagToDocument(db: ReturnType<typeof getDB>, docId: unknown, tag: string, now: number) {
  const doc = db.prepare('SELECT tags FROM corpus_documents WHERE id = ?').get(docId) as { tags: string } | undefined;
  if (!doc) return;
  const tags: string[] = JSON.parse(doc.tags || '[]');
  if (!tags.includes(tag)) {
    tags.push(tag);
    db.prepare('UPDATE corpus_documents SET tags = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(tags), now, docId);
  }
}


app.get('/api/documents/:id/annotations', (req: any, res: any) => {
  try {
    const db = getDB();
    try {
      const rows = db.prepare(
        'SELECT * FROM corpus_annotations WHERE document_id = ? ORDER BY updated_at ASC'
      ).all(req.params.id);
      res.json(rows);
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/documents/:id/annotations', (req: any, res: any) => {
  const { text, tag, corrects_id, author_id, source_passage, start_offset, end_offset } = req.body ?? {};
  // text is optional when source_passage is provided (the passage itself is the primary content)
  const annotationText = text || source_passage;
  if (!annotationText) return res.status(400).json({ error: 'text or source_passage is required' });
  try {
    const db = getDB();
    try {
      const id  = randomUUID();
      const now = Date.now();
      db.prepare(`
        INSERT INTO corpus_annotations
          (id, document_id, text, tag, author_type, author_id, corrects_id,
           source_passage, start_offset, end_offset,
           review_status, is_dirty, last_synced_at, updated_at)
        VALUES (?, ?, ?, ?, 'human', ?, ?, ?, ?, ?, 'accepted', 1, NULL, ?)
      `).run(
        id, req.params.id, annotationText, tag ?? null, author_id ?? null, corrects_id ?? null,
        source_passage ?? null, start_offset ?? null, end_offset ?? null, now,
      );

      if (tag) propagateTagToDocument(db, req.params.id, tag, now);
      pushAnnotationsBackground();
      res.json({ id, status: 'created' });
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Soft-delete: set is_deleted flag rather than removing the row so CRDT sync
// knows the deletion intent. Only the author (human) can delete their own.
app.delete('/api/annotations/:id', (req: any, res: any) => {
  try {
    const db = getDB();
    try {
      const ann = db.prepare('SELECT author_type FROM corpus_annotations WHERE id = ?').get(req.params.id) as { author_type: string } | undefined;
      if (!ann) return res.status(404).json({ error: 'Annotation not found' });
      // Researchers can only delete their own annotations
      if (ann.author_type !== 'human') return res.status(403).json({ error: 'LLM annotations are immutable. Add a correction instead.' });
      db.prepare('DELETE FROM corpus_annotations WHERE id = ?').run(req.params.id);
      res.json({ status: 'deleted' });
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/annotations/:id', (req: any, res: any) => {
  const { tag, text, source_passage } = req.body ?? {};
  try {
    const db = getDB();
    try {
      const ann = db.prepare('SELECT * FROM corpus_annotations WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
      if (!ann) return res.status(404).json({ error: 'Annotation not found' });
      if (ann.author_type !== 'human') return res.status(403).json({ error: 'Only human annotations can be edited.' });

      const updates: string[] = [];
      const params: unknown[] = [];
      const now = Date.now();
      if (tag !== undefined) { updates.push('tag = ?'); params.push(tag); }
      if (text !== undefined && text !== null) { updates.push('text = ?'); params.push(text); }
      if (source_passage !== undefined && source_passage !== null) { updates.push('source_passage = ?'); params.push(source_passage); }

      if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
      updates.push('is_dirty = 1', 'updated_at = ?');
      params.push(now, req.params.id);

      db.prepare(`UPDATE corpus_annotations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      if (tag !== undefined && tag) propagateTagToDocument(db, ann.document_id, tag, now);
      const updated = db.prepare('SELECT * FROM corpus_annotations WHERE id = ?').get(req.params.id);
      res.json(updated);
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Annotation review queue — Phase 4e
// ---------------------------------------------------------------------------

// GET /api/annotations/review?tag=&status=pending
// Returns LLM annotations pending review, joined with document title, plus
// aggregate counts per review_status for the progress counter.
app.get('/api/annotations/review', (req: any, res: any) => {
  const { tag, status = 'pending' } = req.query;
  try {
    const db = getDB();
    try {
      let sql = `
        SELECT ca.*, cd.title AS document_title
        FROM corpus_annotations ca
        JOIN corpus_documents cd ON ca.document_id = cd.id
        WHERE ca.author_type = 'llm' AND ca.review_status = ?
      `;
      const params: unknown[] = [status];
      if (tag) { sql += ' AND ca.tag = ?'; params.push(tag); }
      sql += ' ORDER BY ca.updated_at ASC';
      const annotations = db.prepare(sql).all(...params);

      const counts = db.prepare(`
        SELECT review_status, COUNT(*) AS n
        FROM corpus_annotations
        WHERE author_type = 'llm'
        GROUP BY review_status
      `).all();

      res.json({ annotations, counts });
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// PATCH /api/annotations/:id/review  { action: 'accept'|'reject'|'edit', correction?, tag? }
// accept  — marks review_status = 'accepted' (immutable content, mutable curation state)
// reject  — marks review_status = 'rejected' (soft, never deletes the row)
// edit    — creates a new human annotation (corrects_id → original), marks original accepted
app.patch('/api/annotations/:id/review', (req: any, res: any) => {
  const { action, correction, tag } = req.body ?? {};
  if (!['accept', 'reject', 'edit'].includes(action)) {
    return res.status(400).json({ error: 'action must be accept, reject, or edit' });
  }
  try {
    const db = getDB();
    try {
      const ann = db.prepare('SELECT * FROM corpus_annotations WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
      if (!ann) return res.status(404).json({ error: 'Annotation not found' });

      if (action === 'accept') {
        const now = Date.now();
        db.prepare('UPDATE corpus_annotations SET review_status = ?, updated_at = ? WHERE id = ?').run('accepted', now, req.params.id);
        if (ann.tag) propagateTagToDocument(db, ann.document_id, ann.tag as string, now);
        res.json({ status: 'accepted' });

      } else if (action === 'reject') {
        db.prepare('UPDATE corpus_annotations SET review_status = ? WHERE id = ?').run('rejected', req.params.id);
        res.json({ status: 'rejected' });

      } else {
        // edit: require correction text, create human annotation, mark original accepted
        if (!correction) return res.status(400).json({ error: 'correction is required for edit action' });
        const newId  = randomUUID();
        const now    = Date.now();
        const finalTag = (tag as string | undefined) ?? (ann.tag as string | undefined) ?? null;

        db.prepare(`
          INSERT INTO corpus_annotations
            (id, document_id, text, tag, author_type, author_id, corrects_id, review_status, is_dirty, last_synced_at, updated_at)
          VALUES (?, ?, ?, ?, 'human', 'researcher', ?, 'accepted', 1, NULL, ?)
        `).run(newId, ann.document_id, correction, finalTag, req.params.id, now);

        if (finalTag) propagateTagToDocument(db, ann.document_id, finalTag, now);

        db.prepare('UPDATE corpus_annotations SET review_status = ? WHERE id = ?').run('accepted', req.params.id);
        pushAnnotationsBackground();
        res.json({ status: 'edited', newId });
      }
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// OpenAI-compatible tool API
//
// Exposes the same tool set as MCP but in the OpenAI function-calling format.
// Works with: Ollama (llama3.1/qwen2.5/mistral-nemo), Claude API, Gemini,
// LiteLLM, or any custom agent/notebook — no MCP client required.
//
// Usage:
//   GET  /api/tools          → pass directly as `tools:` in openai.chat.completions.create()
//   POST /api/tools/call     → { name, arguments } → { result }
// ---------------------------------------------------------------------------

const OPENAI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_corpus',
      description: 'List all corpus documents (metadata only — title, author, date, tags, annotation count). Use get_document for full text.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_document',
      description: 'Fetch the full content and all annotations (LLM + human) of a corpus document by ID.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Document ID from read_corpus.' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_corpus',
      description: 'Full-text search across the corpus (SQLite FTS5). Supports phrases ("nature metaphor"), boolean (Kant AND sublime), prefix wildcards (philos*). Returns ranked results with passage snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'FTS5 search query.' },
          limit: { type: 'number', description: 'Max results (default 10).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_document',
      description: 'Analyze a corpus document for specific terms or phrases. Returns occurrence counts and surrounding passage excerpts (200 chars context) for each term. Ideal for locating philosophical concepts, rhetorical patterns, and metaphors in historical texts.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
          terms: { type: 'array', items: { type: 'string' }, description: 'Terms or phrases to search for within the document.' },
        },
        required: ['documentId', 'terms'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_annotations',
      description: 'List all annotations on a document — both LLM-generated and human-authored. Check this before annotating to avoid duplicating existing observations.',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'string' } },
        required: ['documentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'annotate_document',
      description: 'Write an LLM analytical annotation to a corpus document. Creates an immutable row in corpus_annotations (append-only CRDT) — never overwrites researcher annotations. Researcher corrections appear as separate human-authored rows.',
      parameters: {
        type: 'object',
        properties: {
          documentId:  { type: 'string' },
          annotation:  { type: 'string', description: 'The analytical observation or interpretation.' },
          tag:         { type: 'string', description: 'Short classification label, e.g. "kantian-sublime".' },
          authorId:    { type: 'string', description: 'Model identifier, e.g. "gpt-4o" or "ollama/llama3.1".' },
          correctsId:  { type: 'string', description: 'UUID of an existing annotation this refines.' },
        },
        required: ['documentId', 'annotation'],
      },
    },
  },
] as const;

app.get('/api/tools', (_req, res: any) => {
  res.json({ tools: OPENAI_TOOLS });
});

// Accepts both OpenAI format ({ name, arguments: string|object })
// and a plain { name, arguments: object } for convenience.
app.post('/api/tools/call', async (req: any, res: any) => {
  const { name, arguments: rawArgs } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  let args: Record<string, unknown>;
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs ?? {});
  } catch {
    return res.status(400).json({ error: 'arguments must be valid JSON' });
  }

  try {
    const result = await handleToolCall(name, args);
    const text = result.content.map((c: { text?: string }) => c.text ?? '').join('\n');
    res.json({ result: text, isError: false });
  } catch (error) {
    res.status(500).json({ result: (error as Error).message, isError: true });
  }
});

// ---------------------------------------------------------------------------
// MCP over SSE — lets local LLMs (Ollama via Open WebUI, AnythingLLM,
// Continue.dev) connect to the same tool set as Claude Desktop.
//
// Client config:
//   SSE URL:      http://localhost:3000/mcp/sse
//   Messages URL: http://localhost:3000/mcp/messages
// ---------------------------------------------------------------------------

const sseTransports: Record<string, SSEServerTransport> = {};

app.get('/mcp/sse', async (req: any, res: any) => {
  const transport = new SSEServerTransport('/mcp/messages', res);
  const mcpServer = createMcpServer();
  sseTransports[transport.sessionId] = transport;
  res.on('close', () => delete sseTransports[transport.sessionId]);
  await mcpServer.connect(transport);
});

app.post('/mcp/messages', async (req: any, res: any) => {
  const sessionId = req.query.sessionId as string;
  const transport = sseTransports[sessionId];
  if (!transport) {
    res.status(404).json({ error: 'Session not found. Connect via GET /mcp/sse first.' });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

// ---------------------------------------------------------------------------
// Supabase sync
// ---------------------------------------------------------------------------

app.get('/api/sync/status', (_req, res: any) => {
  try {
    const db = getDB();
    try {
      const dirtyDocs = (db.prepare('SELECT COUNT(*) as n FROM corpus_documents WHERE is_dirty = 1').get() as { n: number }).n;
      const dirtyAnns = (db.prepare('SELECT COUNT(*) as n FROM corpus_annotations WHERE is_dirty = 1').get() as { n: number }).n;
      const tokenDocs = (db.prepare('SELECT value FROM sync_state WHERE key = ?').get(CorpusSchema.syncTokenKey) as { value: string } | undefined)?.value;
      const tokenAnns = (db.prepare('SELECT value FROM sync_state WHERE key = ?').get(AnnotationSchema.syncTokenKey) as { value: string } | undefined)?.value;
      res.json({
        configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY),
        dirty_documents:    dirtyDocs,
        dirty_annotations:  dirtyAnns,
        last_synced_documents:   tokenDocs ? new Date(Number(tokenDocs)).toISOString() : null,
        last_synced_annotations: tokenAnns ? new Date(Number(tokenAnns)).toISOString() : null,
      });
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/sync', async (_req, res: any) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    return res.status(400).json({ error: 'Supabase not configured. Add SUPABASE_URL and SUPABASE_KEY to .env' });
  }
  const db = getDB();
  try {
    const results: Record<string, { pushed: string; pulled: string }> = {};
    for (const schema of [CorpusSchema, AnnotationSchema]) {
      const transport = new SupabaseTransport(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_KEY,
        schema.tableName,
        schema.jsonFields,
      );
      await new SyncCoordinator(db, transport, schema).sync();
      results[schema.tableName] = { pushed: 'ok', pulled: 'ok' };
    }
    res.json({ status: 'ok', synced: results, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// Agentic query runner — SSE stream
//
// ---------------------------------------------------------------------------
// LLM adapter — supports OpenAI-compatible (Ollama, OpenAI, …) and Anthropic
// ---------------------------------------------------------------------------

interface LLMToolCall { id: string; name: string; arguments: Record<string, unknown> }
interface LLMResult   { rawMessage: Record<string, unknown>; content: string | null; toolCalls: LLMToolCall[] }

function isAnthropicEndpoint(endpoint: string, apiKey: string | null) {
  return endpoint.includes('anthropic.com') || (apiKey ?? '').startsWith('sk-ant-');
}

function toAnthropicMessages(msgs: Record<string, unknown>[]) {
  const out: Record<string, unknown>[] = [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    } else if (m.role === 'assistant' && Array.isArray((m as any).tool_calls)) {
      const content: unknown[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of (m as any).tool_calls) {
        const args = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments) : tc.function.arguments;
        content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: args });
      }
      out.push({ role: 'assistant', content });
    } else {
      out.push(m);
    }
  }
  return out;
}

function toAnthropicTools(tools: readonly any[]) {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

async function callLLM(
  endpoint: string,
  apiKey: string | null,
  model: string,
  messages: Record<string, unknown>[],
  tools: readonly any[],
): Promise<{ ok: false; error: string } | ({ ok: true } & LLMResult)> {

  if (isAnthropicEndpoint(endpoint, apiKey)) {
    const sysMsg  = messages.find(m => m.role === 'system');
    const anthMsgs = toAnthropicMessages(messages);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: sysMsg?.content ?? '',
        messages: anthMsgs,
        tools: toAnthropicTools(tools),
      }),
    });
    if (!res.ok) return { ok: false, error: `Anthropic error ${res.status}: ${await res.text()}` };
    const data = await res.json() as {
      content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
    };
    const textBlock = data.content.find(c => c.type === 'text');
    const toolUses  = data.content.filter(c => c.type === 'tool_use');
    // Store back in OpenAI-canonical format so the messages array stays uniform
    const rawMessage: Record<string, unknown> = {
      role: 'assistant',
      content: textBlock?.text ?? null,
      ...(toolUses.length ? {
        tool_calls: toolUses.map(t => ({
          id: t.id,
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
        })),
      } : {}),
    };
    return {
      ok: true, rawMessage,
      content: textBlock?.text ?? null,
      toolCalls: toolUses.map(t => ({ id: t.id!, name: t.name!, arguments: t.input ?? {} })),
    };
  }

  // OpenAI-compatible
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey ?? 'ollama'}` },
    body: JSON.stringify({ model, tools, messages }),
  });
  if (!res.ok) return { ok: false, error: `LLM error ${res.status}: ${await res.text()}` };
  const data = await res.json() as {
    choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string | Record<string, unknown> } }[] } }[];
  };
  const msg = data.choices[0]?.message;
  if (!msg) return { ok: false, error: 'Empty response from model' };
  return {
    ok: true,
    rawMessage: msg as Record<string, unknown>,
    content: msg.content,
    toolCalls: (msg.tool_calls ?? []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function.arguments as Record<string, unknown>,
    })),
  };
}

// POST /api/run  { systemPrompt, userMessage, model, ollamaUrl }
// Streams: { type: 'tool_call'|'tool_result'|'answer'|'error'|'done', ... }
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT =
  'You are a musicology research assistant. ' +
  'Use the available tools to analyse the corpus. ' +
  'When you find a relevant passage, write an annotation with a concise tag. ' +
  'The corpus is in German. Write every annotation in German. Do not translate. Do not use English. ' +
  'IMPORTANT: Always use document IDs returned by search_corpus or read_corpus. ' +
  'Never invent or guess a document ID. ' +
  'If search_corpus returns no results, try a shorter or simpler keyword (1–2 words maximum). ' +
  'Do not use full sentences or phrases as search queries.';

app.post('/api/run', async (req: any, res: any) => {
  const {
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    userMessage,
    model = 'qwen2.5:7b',
    ollamaUrl = 'http://localhost:11434/v1/chat/completions',
    apiKey,
  } = req.body ?? {};

  if (!userMessage) return res.status(400).json({ error: 'userMessage is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const messages: Record<string, unknown>[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userMessage  },
  ];

  try {
    for (let step = 0; step < 10; step++) {
      const llm = await callLLM(ollamaUrl, apiKey ?? null, model, messages, OPENAI_TOOLS);
      if (!llm.ok) { send({ type: 'error', message: llm.error }); break; }

      messages.push(llm.rawMessage);

      if (!llm.toolCalls.length) {
        send({ type: 'answer', text: llm.content });
        break;
      }

      for (const call of llm.toolCalls) {
        send({ type: 'tool_call', name: call.name, args: call.arguments });

        const result = await handleToolCall(call.name, call.arguments);
        const text = result.content.map((c: { text?: string }) => c.text ?? '').join('\n');

        send({ type: 'tool_result', name: call.name, result: text.slice(0, 600) });

        messages.push({ role: 'tool', tool_call_id: call.id, content: text });
      }
    }
  } catch (error) {
    send({ type: 'error', message: (error as Error).message });
  }

  send({ type: 'done' });
  res.end();
});

// ---------------------------------------------------------------------------
// Batch annotation runner — SSE stream
//
// POST /api/batch-run  { concept, tag, systemPrompt?, model?, ollamaUrl?, delayMs?, resume? }
// Streams: started | progress | skipped | tool_call | tool_result | error | done
// ---------------------------------------------------------------------------

app.post('/api/batch-run', async (req: any, res: any) => {
  const {
    concept,
    tag,
    systemPrompt,
    model = 'qwen2.5:7b',
    ollamaUrl = 'http://localhost:11434/v1/chat/completions',
    apiKey,
    delayMs = 500,
    resume = true,
  } = req.body ?? {};

  if (!concept || !tag) return res.status(400).json({ error: 'concept and tag are required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const defaultSystemPrompt =
    `You are analyzing a research corpus for the concept: "${concept}".\n\n` +
    `For the document provided, you MUST:\n` +
    `1. Call analyze_document with the document ID and relevant search terms\n` +
    `2. Call annotate_document to write a structured observation with tag: "${tag}"\n\n` +
    `Do NOT call read_corpus, search_corpus, or get_document.\n` +
    `Use only the document ID given in the user message.`;

  const sysPrompt = systemPrompt || defaultSystemPrompt;

  // Fetch all docs ordered by updated_at ASC
  let docs: { id: string; title: string }[];
  {
    const db = getDB();
    try {
      docs = db.prepare('SELECT id, title FROM corpus_documents ORDER BY updated_at ASC').all() as { id: string; title: string }[];
    } finally {
      db.close();
    }
  }

  const total = docs.length;
  send({ type: 'started', total });

  let annotated = 0, skipped = 0, errors = 0;
  let stopped = false;
  res.on('close', () => { stopped = true; });

  for (let i = 0; i < docs.length; i++) {
    if (stopped) break;

    const doc = docs[i]!;
    const current = i + 1;

    // Resume: skip docs already tagged
    if (resume) {
      const db = getDB();
      try {
        const existing = db.prepare(
          'SELECT id FROM corpus_annotations WHERE document_id = ? AND tag = ? LIMIT 1'
        ).get(doc.id, tag);
        if (existing) {
          send({ type: 'skipped', current, total, documentId: doc.id, title: doc.title });
          skipped++;
          continue;
        }
      } finally {
        db.close();
      }
    }

    send({ type: 'progress', current, total, documentId: doc.id, title: doc.title });

    const messages: Record<string, unknown>[] = [
      { role: 'system', content: sysPrompt },
      {
        role: 'user',
        content: `Document ID: ${doc.id}\nTitle: ${doc.title}\n\nAnalyze this document for the concept "${concept}" and annotate with tag "${tag}".`,
      },
    ];

    let didAnnotate = false;
    try {
      for (let step = 0; step < 6; step++) {
        if (stopped) break;

        const llm = await callLLM(ollamaUrl, apiKey ?? null, model, messages, OPENAI_TOOLS);
        if (!llm.ok) {
          send({ type: 'error', documentId: doc.id, message: llm.error });
          errors++;
          break;
        }

        messages.push(llm.rawMessage);

        if (!llm.toolCalls.length) break;

        for (const call of llm.toolCalls) {
          send({ type: 'tool_call', documentId: doc.id, name: call.name, args: call.arguments });

          if (call.name === 'annotate_document') didAnnotate = true;

          const result = await handleToolCall(call.name, call.arguments);
          const text = result.content.map((c: { text?: string }) => c.text ?? '').join('\n');

          send({ type: 'tool_result', documentId: doc.id, name: call.name, result: text.slice(0, 600) });

          messages.push({ role: 'tool', tool_call_id: call.id, content: text });
        }
      }
    } catch (error) {
      send({ type: 'error', documentId: doc.id, message: (error as Error).message });
      errors++;
    }

    if (didAnnotate) annotated++;

    if (delayMs > 0 && i < docs.length - 1 && !stopped) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  send({ type: 'done', annotated, skipped, errors, total });
  res.end();
});

// ---------------------------------------------------------------------------
// Tag browser endpoints
// ---------------------------------------------------------------------------

// GET /api/tags/summary
// Returns all unique tags with doc_count (documents carrying that tag) and
// highlight_count (human inline annotations with that tag), sorted by
// total frequency descending.
app.get('/api/tags/summary', (_req, res: any) => {
  try {
    const db = getDB();
    try {
      // Aggregate per-tag document counts from the JSON tags array column
      const docs = db.prepare('SELECT id, tags FROM corpus_documents').all() as { id: string; tags: string }[];
      const tagDocSet = new Map<string, Set<string>>();
      for (const doc of docs) {
        let tagArr: string[] = [];
        try { tagArr = JSON.parse(doc.tags || '[]'); } catch { /* skip malformed */ }
        for (const tag of tagArr) {
          if (!tagDocSet.has(tag)) tagDocSet.set(tag, new Set());
          tagDocSet.get(tag)!.add(doc.id);
        }
      }

      // Count inline highlights per tag from the annotations table
      const hlRows = db.prepare(`
        SELECT tag, COUNT(*) AS n
        FROM corpus_annotations
        WHERE author_type = 'human' AND tag IS NOT NULL
        GROUP BY tag
      `).all() as { tag: string; n: number }[];
      const tagHlCount = new Map<string, number>(hlRows.map(r => [r.tag, r.n]));

      // Union of all tags seen in either source
      const allTags = new Set([...tagDocSet.keys(), ...tagHlCount.keys()]);
      const summary = [...allTags].map(tag => ({
        tag,
        doc_count:       tagDocSet.get(tag)?.size ?? 0,
        highlight_count: tagHlCount.get(tag) ?? 0,
      })).sort((a, b) => (b.doc_count + b.highlight_count) - (a.doc_count + a.highlight_count));

      res.json(summary);
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/tags/:tag/highlights
// Returns all inline human annotations for a given tag, joined with their
// document title / author / date — used to populate the highlights panel.
app.get('/api/tags/:tag/highlights', (req: any, res: any) => {
  try {
    const db = getDB();
    try {
      const rows = db.prepare(`
        SELECT ca.id, ca.text, ca.tag, ca.updated_at, ca.document_id,
               cd.title AS document_title, cd.author, cd.publication_date
        FROM corpus_annotations ca
        JOIN corpus_documents cd ON ca.document_id = cd.id
        WHERE ca.author_type = 'human' AND ca.author_id = 'inline' AND ca.tag = ?
        ORDER BY cd.publication_date ASC, ca.updated_at ASC
      `).all(req.params.tag);
      res.json(rows);
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Analysis endpoints — Phase 4 research tools
// ---------------------------------------------------------------------------

// GET /api/analysis/kwic?q=term&window=100
// KWIC (Key Word In Context) concordance — returns every occurrence of a term
// across the corpus with surrounding context characters.
app.get('/api/analysis/kwic', (req: any, res: any) => {
  const term   = String(req.query.q ?? '').trim();
  const window = Math.min(200, Math.max(20, parseInt(String(req.query.window ?? '100'), 10)));
  if (!term) return res.json([]);
  try {
    const db = getDB();
    try {
      const docs = db.prepare(
        'SELECT id, title, publication_date, content FROM corpus_documents'
      ).all() as { id: string; title: string; publication_date: string; content: string }[];

      const results: { doc_id: string; doc_title: string; doc_date: string; left: string; match: string; right: string }[] = [];
      const termLower = term.toLowerCase();

      outer: for (const doc of docs) {
        const content = doc.content || '';
        const lower   = content.toLowerCase();
        let idx = 0;
        while (true) {
          const pos = lower.indexOf(termLower, idx);
          if (pos === -1) break;
          results.push({
            doc_id:    doc.id,
            doc_title: doc.title,
            doc_date:  doc.publication_date,
            left:      content.slice(Math.max(0, pos - window), pos),
            match:     content.slice(pos, pos + term.length),
            right:     content.slice(pos + term.length, Math.min(content.length, pos + term.length + window)),
          });
          idx = pos + 1;
          if (results.length >= 200) break outer;
        }
      }
      res.json(results);
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/analysis/cooccurrence
// Tag co-occurrence — which tag pairs appear together on the same document.
// Counts are based on doc.tags JSON column (includes propagated annotation tags).
app.get('/api/analysis/cooccurrence', (_req, res: any) => {
  try {
    const db = getDB();
    try {
      const docs = db.prepare('SELECT id, tags FROM corpus_documents').all() as { id: string; tags: string }[];
      const pairCounts = new Map<string, number>();

      for (const doc of docs) {
        let tags: string[] = [];
        try { tags = [...new Set(JSON.parse(doc.tags || '[]') as string[])]; } catch { continue; }
        for (let i = 0; i < tags.length; i++) {
          for (let j = i + 1; j < tags.length; j++) {
            const key = [tags[i], tags[j]].sort().join('\0');
            pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
          }
        }
      }

      const pairs = [...pairCounts.entries()]
        .map(([key, count]) => { const [a, b] = key.split('\0'); return { tag_a: a, tag_b: b, count }; })
        .sort((a, b) => b.count - a.count)
        .slice(0, 60);

      res.json(pairs);
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/analysis/timeline
// Document timeline — docs with publication date, annotation count, dominant tag.
app.get('/api/analysis/timeline', (_req, res: any) => {
  try {
    const db = getDB();
    try {
      const docs = db.prepare(`
        SELECT id, title, author, publication_date, tags
        FROM corpus_documents
        WHERE publication_date IS NOT NULL AND publication_date != ''
        ORDER BY publication_date ASC
      `).all() as { id: string; title: string; author: string; publication_date: string; tags: string }[];

      const annRows = db.prepare(`
        SELECT document_id, tag, COUNT(*) AS n
        FROM corpus_annotations
        WHERE author_type = 'human' AND tag IS NOT NULL
        GROUP BY document_id, tag
      `).all() as { document_id: string; tag: string; n: number }[];

      // Build per-doc annotation count + dominant tag
      const annMap = new Map<string, { count: number; tagCounts: Map<string, number> }>();
      for (const row of annRows) {
        if (!annMap.has(row.document_id)) annMap.set(row.document_id, { count: 0, tagCounts: new Map() });
        const e = annMap.get(row.document_id)!;
        e.count += row.n;
        e.tagCounts.set(row.tag, (e.tagCounts.get(row.tag) ?? 0) + row.n);
      }

      const result = docs.map(doc => {
        const ann = annMap.get(doc.id);
        let docTags: string[] = [];
        try { docTags = JSON.parse(doc.tags || '[]'); } catch { /* */ }
        const dominantTag = ann?.tagCounts.size
          ? [...ann.tagCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
          : (docTags[0] ?? null);
        return {
          id: doc.id, title: doc.title, author: doc.author,
          publication_date: doc.publication_date,
          annotation_count: ann?.count ?? 0,
          dominant_tag: dominantTag,
        };
      });

      res.json(result);
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Strip inline markup migration
// ---------------------------------------------------------------------------

app.post('/api/corpus/strip-markup', (_req, res: any) => {
  try {
    const db = getDB();
    try {
      const docs = db.prepare('SELECT id, content FROM corpus_documents').all() as { id: string; content: string }[];
      const update = db.prepare('UPDATE corpus_documents SET content = ?, is_dirty = 1, updated_at = ? WHERE id = ?');
      const now = Date.now();
      let updated = 0;
      db.transaction(() => {
        for (const doc of docs) {
          const cleaned = stripInlineMarkup(doc.content || '');
          if (cleaned !== doc.content) {
            update.run(cleaned, now, doc.id);
            updated++;
          }
        }
      })();
      res.json({ updated });
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Corpus export — zip of .md files + annotations.csv
// ---------------------------------------------------------------------------

app.get('/api/export', (_req, res: any) => {
  try {
    const db = getDB();
    try {
      const docs = db.prepare(
        'SELECT * FROM corpus_documents ORDER BY publication_date ASC, title ASC'
      ).all() as any[];
      const annotations = db.prepare(
        'SELECT * FROM corpus_annotations ORDER BY document_id, updated_at ASC'
      ).all() as any[];

      const zip = new AdmZip();

      // RFC 4180 CSV quoting: always double-quote, escape " as ""
      const q = (s: unknown) => '"' + String(s ?? '').replace(/"/g, '""') + '"';

      // ── One .md per document ───────────────────────────────────────────
      const docTitles = new Map<string, string>();
      for (const doc of docs) {
        docTitles.set(doc.id, doc.title);
        const tags = JSON.parse(doc.tags || '[]') as string[];
        const meta = JSON.parse(doc.metadata || '{}') as Record<string, unknown>;

        const fm: string[] = ['---'];
        fm.push(`title: ${q(doc.title)}`);
        fm.push(`author: ${q(doc.author)}`);
        fm.push(`publication_date: ${doc.publication_date}`);
        if (meta.source) fm.push(`source: ${q(meta.source)}`);
        if (tags.length) fm.push(`tags: [${tags.join(', ')}]`);
        fm.push('---', '', doc.content || '');

        const slug = String(doc.title)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 80) || doc.id;

        zip.addFile(`documents/${slug}.md`, Buffer.from(fm.join('\n'), 'utf-8'));
      }

      // ── annotations.csv ───────────────────────────────────────────────
      const header = [
        'document_id', 'document_title', 'tag', 'source_passage',
        'text', 'author_type', 'review_status', 'updated_at',
      ].join(',');

      const rows = annotations.map((a: any) => [
        q(a.document_id),
        q(docTitles.get(a.document_id) ?? ''),
        q(a.tag),
        q(a.source_passage),
        q(a.text),
        q(a.author_type),
        q(a.review_status),
        q(a.updated_at ? new Date(Number(a.updated_at)).toISOString() : ''),
      ].join(','));

      zip.addFile('annotations.csv', Buffer.from([header, ...rows].join('\n'), 'utf-8'));

      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="corpus-export-${date}.zip"`);
      res.send(zip.toBuffer());
    } finally { db.close(); }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/health', (_req, res: any) => {
  try {
    const db = getDB();
    const result = db.prepare('SELECT 1 as val').get() as { val: number };
    db.close();
    res.json({ status: 'ok', db: result.val === 1 ? 'connected' : 'error' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const entryFile = process.argv[1];

if (entryFile && (entryFile === __filename || entryFile.endsWith('web.ts'))) {
  app.listen(PORT, () => {
    console.log(`Web interface running at http://localhost:${PORT}`);
  });
}

export default app;
