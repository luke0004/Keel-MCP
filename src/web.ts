import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import { getDB, initSchema, initCorpusFTS, initActivityLog, initAnnotationsTable } from './db/index.js';
import { LogbookSchema, CorpusSchema, AnnotationSchema } from './schema.js';
import { AgentMemorySchema } from './schemas/AgentMemory.js';
import multer from 'multer';
import { IngestionService } from './ingestion.js';
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
    res.json(rows);
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
  const { text, tag, corrects_id, author_id } = req.body ?? {};
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    const db = getDB();
    try {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(`
        INSERT INTO corpus_annotations
          (id, document_id, text, tag, author_type, author_id, corrects_id, is_dirty, last_synced_at, updated_at)
        VALUES (?, ?, ?, ?, 'human', ?, ?, 1, NULL, ?)
      `).run(id, req.params.id, text, tag ?? null, author_id ?? null, corrects_id ?? null, now);

      // Propagate new tag to document (additive only)
      if (tag) {
        const doc = db.prepare('SELECT tags FROM corpus_documents WHERE id = ?').get(req.params.id) as { tags: string } | undefined;
        if (doc) {
          const tags: string[] = JSON.parse(doc.tags || '[]');
          if (!tags.includes(tag)) {
            tags.push(tag);
            db.prepare('UPDATE corpus_documents SET tags = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(tags), now, req.params.id);
          }
        }
      }
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
      const llmRes = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey ?? 'ollama'}` },
        body: JSON.stringify({ model, tools: OPENAI_TOOLS, messages }),
      });

      if (!llmRes.ok) {
        send({ type: 'error', message: `LLM error ${llmRes.status}: ${await llmRes.text()}` });
        break;
      }

      const data = await llmRes.json() as { choices: { message: { content: string; tool_calls?: { id: string; function: { name: string; arguments: string | Record<string, unknown> } }[] } }[] };
      const msg = data.choices[0]?.message;
      if (!msg) { send({ type: 'error', message: 'Empty response from model' }); break; }
      messages.push(msg as Record<string, unknown>);

      if (!msg.tool_calls?.length) {
        send({ type: 'answer', text: msg.content });
        break;
      }

      for (const call of msg.tool_calls) {
        let args: Record<string, unknown>;
        try {
          args = typeof call.function.arguments === 'string'
            ? JSON.parse(call.function.arguments)
            : (call.function.arguments as Record<string, unknown>);
        } catch { args = {}; }

        send({ type: 'tool_call', name: call.function.name, args });

        const result = await handleToolCall(call.function.name, args);
        const text = result.content.map((c: { text?: string }) => c.text ?? '').join('\n');

        send({ type: 'tool_result', name: call.function.name, result: text.slice(0, 600) });

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

        const llmRes = await fetch(ollamaUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey ?? 'ollama'}` },
          body: JSON.stringify({ model, tools: OPENAI_TOOLS, messages }),
        });

        if (!llmRes.ok) {
          send({ type: 'error', documentId: doc.id, message: `LLM error ${llmRes.status}: ${await llmRes.text()}` });
          errors++;
          break;
        }

        const data = await llmRes.json() as {
          choices: { message: { content: string; tool_calls?: { id: string; function: { name: string; arguments: string | Record<string, unknown> } }[] } }[];
        };
        const msg = data.choices[0]?.message;
        if (!msg) {
          send({ type: 'error', documentId: doc.id, message: 'Empty response from model' });
          errors++;
          break;
        }
        messages.push(msg as Record<string, unknown>);

        if (!msg.tool_calls?.length) break;

        for (const call of msg.tool_calls) {
          let args: Record<string, unknown>;
          try {
            args = typeof call.function.arguments === 'string'
              ? JSON.parse(call.function.arguments)
              : (call.function.arguments as Record<string, unknown>);
          } catch { args = {}; }

          send({ type: 'tool_call', documentId: doc.id, name: call.function.name, args });

          if (call.function.name === 'annotate_document') didAnnotate = true;

          const result = await handleToolCall(call.function.name, args);
          const text = result.content.map((c: { text?: string }) => c.text ?? '').join('\n');

          send({ type: 'tool_result', documentId: doc.id, name: call.function.name, result: text.slice(0, 600) });

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
