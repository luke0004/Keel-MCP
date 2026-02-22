/**
 * MCP Server factory — shared between the stdio runner (server.ts) and the
 * SSE HTTP transport (web.ts).  Each caller gets a fresh Server instance with
 * the full tool set wired up.
 */

import { randomUUID } from "node:crypto";
// randomUUID used in annotate_document to generate stable annotation IDs
import { config } from "dotenv";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDB } from "./db/index.js";
import { SyncCoordinator } from "./core/SyncCoordinator.js";
import { SupabaseTransport } from "./core/SupabaseTransport.js";
import { LogbookSchema, CorpusSchema, AnnotationSchema } from "./schema.js";
import { AgentMemorySchema } from "./schemas/AgentMemory.js";
import { logActivityToDB } from "./activity.js";

// ---------------------------------------------------------------------------
// Background sync helper
// ---------------------------------------------------------------------------

/** Push dirty rows for any schema to Supabase in the background (fire-and-forget). */
function pushSchemaBackground(schema: typeof CorpusSchema) {
  config();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return;
  const db = getDB();
  try {
    const transport = new SupabaseTransport(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY,
      schema.tableName,
      schema.jsonFields,
    );
    new SyncCoordinator(db, transport, schema).push().catch(() => {});
  } finally {
    db.close();
  }
}

export function pushDocumentsBackground()   { pushSchemaBackground(CorpusSchema); }
export function pushAnnotationsBackground() { pushSchemaBackground(AnnotationSchema); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPassages(
  content: string,
  term: string,
  maxPassages = 5,
  contextChars = 200,
): string[] {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");
  const passages: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null && passages.length < maxPassages) {
    const start = Math.max(0, match.index - contextChars);
    const end = Math.min(content.length, match.index + match[0].length + contextChars);
    passages.push((start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : ""));
  }
  return passages;
}

// ---------------------------------------------------------------------------
// Tool handler (pure logic, no transport concerns)
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  params: Record<string, unknown>,
) {
  // ── read_recent_logs ──────────────────────────────────────────────────────
  if (name === "read_recent_logs") {
    const limit = Number(params?.limit ?? 20);
    const sql = `SELECT * FROM logbook_entries ORDER BY updated_at DESC LIMIT ${limit}`;
    const db = getDB();
    try {
      const rows = db.prepare(sql).all() as Record<string, unknown>[];
      logActivityToDB({ tool: name, params, sqlPreview: sql, resultSummary: `Returned ${rows.length} log entries` });
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    } finally { db.close(); }
  }

  // ── search_logs ───────────────────────────────────────────────────────────
  if (name === "search_logs") {
    const query = String(params?.query ?? "");
    const sql = `SELECT * FROM logbook_entries WHERE title LIKE '%${query}%' OR body LIKE '%${query}%'`;
    const db = getDB();
    try {
      const pattern = `%${query}%`;
      const rows = db.prepare("SELECT * FROM logbook_entries WHERE title LIKE ? OR body LIKE ?").all(pattern, pattern) as Record<string, unknown>[];
      logActivityToDB({ tool: name, params, sqlPreview: sql, resultSummary: `Found ${rows.length} entries matching "${query}"` });
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    } finally { db.close(); }
  }

  // ── log_entry ─────────────────────────────────────────────────────────────
  if (name === "log_entry") {
    const parsed = z.object({ title: z.string(), body: z.string(), tags: z.array(z.string()), wind_speed: z.number() }).parse(params);
    const db = getDB();
    const id = randomUUID();
    const now = Date.now();
    try {
      db.prepare(`INSERT INTO logbook_entries (id, title, body, tags, crew, field_timestamps, wind_speed, is_dirty, last_synced_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)`)
        .run(id, parsed.title, parsed.body, JSON.stringify(parsed.tags), JSON.stringify([]), null, parsed.wind_speed, now);
    } finally { db.close(); }

    config();
    const db2 = getDB();
    try {
      if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
        const t = new SupabaseTransport(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, LogbookSchema.tableName, LogbookSchema.jsonFields);
        new SyncCoordinator(db2, t, LogbookSchema).push().catch(() => {});
      }
    } finally { db2.close(); }

    logActivityToDB({ tool: name, params, resultSummary: `Logged entry "${parsed.title}" (id: ${id})` });
    return { content: [{ type: "text" as const, text: "Log saved and syncing..." }] };
  }

  // ── sync_now ──────────────────────────────────────────────────────────────
  if (name === "sync_now") {
    config();
    const db = getDB();
    try {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_KEY");
      const t = new SupabaseTransport(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, LogbookSchema.tableName, LogbookSchema.jsonFields);
      await new SyncCoordinator(db, t, LogbookSchema).sync();
    } finally { db.close(); }
    logActivityToDB({ tool: name, params, resultSummary: "Full push+pull sync completed" });
    return { content: [{ type: "text" as const, text: "Sync complete." }] };
  }

  // ── remember_fact ─────────────────────────────────────────────────────────
  if (name === "remember_fact") {
    const parsed = z.object({ key: z.string(), value: z.string(), tags: z.array(z.string()).optional().default([]) }).parse(params);
    const db = getDB();
    const id = randomUUID();
    const now = Date.now();
    try {
      db.prepare(`INSERT INTO agent_memory (id, key, value, agent_id, context_tags, confidence, field_timestamps, is_dirty, last_synced_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)`)
        .run(id, parsed.key, parsed.value, "keel-mcp", JSON.stringify(parsed.tags), 1.0, null, now);
    } finally { db.close(); }

    config();
    const db2 = getDB();
    try {
      if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
        const t = new SupabaseTransport(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, AgentMemorySchema.tableName, AgentMemorySchema.jsonFields);
        new SyncCoordinator(db2, t, AgentMemorySchema).push().catch(() => {});
      }
    } finally { db2.close(); }

    logActivityToDB({ tool: name, params, resultSummary: `Remembered: ${parsed.key} = "${parsed.value}"` });
    return { content: [{ type: "text" as const, text: `Fact '${parsed.key}' remembered.` }] };
  }

  // ── recall_fact ───────────────────────────────────────────────────────────
  if (name === "recall_fact") {
    const { key } = z.object({ key: z.string() }).parse(params);
    const sql = `SELECT * FROM agent_memory WHERE key = '${key}'`;
    const db = getDB();
    try {
      const rows = db.prepare("SELECT * FROM agent_memory WHERE key = ?").all(key) as Record<string, unknown>[];
      logActivityToDB({ tool: name, params, sqlPreview: sql, resultSummary: rows.length ? `Found: "${String(rows[0]?.value ?? "")}"` : "Not found" });
      return { content: [{ type: "text" as const, text: rows.length ? JSON.stringify(rows, null, 2) : "Fact not found." }] };
    } finally { db.close(); }
  }

  // ── read_corpus ───────────────────────────────────────────────────────────
  if (name === "read_corpus") {
    const sql = `SELECT id, title, author, publication_date, tags, metadata, updated_at FROM corpus_documents ORDER BY updated_at DESC`;
    const db = getDB();
    try {
      const rows = db.prepare(sql).all() as Record<string, unknown>[];
      const enriched = rows.map(row => {
        try {
          const meta = JSON.parse(row.metadata as string ?? "{}");
          return { ...row, annotation_count: (meta.annotations ?? []).length, metadata: undefined };
        } catch { return { ...row, annotation_count: 0, metadata: undefined }; }
      });
      logActivityToDB({ tool: name, params, sqlPreview: sql, resultSummary: `Listed ${rows.length} documents (metadata only)` });
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    } finally { db.close(); }
  }

  // ── get_document ──────────────────────────────────────────────────────────
  if (name === "get_document") {
    const { id } = z.object({ id: z.string() }).parse(params);
    const sql = `SELECT * FROM corpus_documents WHERE id = '${id}'`;
    const db = getDB();
    try {
      const row = db.prepare("SELECT * FROM corpus_documents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      if (!row) {
        logActivityToDB({ tool: name, params, sqlPreview: sql, resultSummary: `Not found: ${id}` });
        return { content: [{ type: "text" as const, text: "Document not found." }] };
      }
      const wordCount = String(row.content ?? "").split(/\s+/).filter(Boolean).length;
      // Join first-class annotations (CRDT-safe rows, not the legacy metadata blob)
      const annotations = db.prepare(
        "SELECT id, text, tag, author_type, author_id, corrects_id, updated_at FROM corpus_annotations WHERE document_id = ? ORDER BY updated_at ASC"
      ).all(id) as Record<string, unknown>[];
      logActivityToDB({ tool: name, params, sqlPreview: sql, resultSummary: `Fetched "${row.title}" (${wordCount} words, ${annotations.length} annotations)` });
      return { content: [{ type: "text" as const, text: JSON.stringify({ ...row, word_count: wordCount, annotations }, null, 2) }] };
    } finally { db.close(); }
  }

  // ── search_corpus ─────────────────────────────────────────────────────────
  if (name === "search_corpus") {
    const { query, limit: rawLimit } = z.object({ query: z.string(), limit: z.number().optional().default(10) }).parse(params);
    const limit = rawLimit ?? 10;
    const ftsSql =
      `SELECT cd.id, cd.title, cd.author, cd.publication_date, cd.tags,\n` +
      `  snippet(corpus_fts, 2, '**', '**', '…', 32) AS snippet\n` +
      `FROM corpus_fts JOIN corpus_documents cd ON corpus_fts.rowid = cd.rowid\n` +
      `WHERE corpus_fts MATCH '${query}' ORDER BY rank LIMIT ${limit}`;

    const db = getDB();
    try {
      let rows: Record<string, unknown>[];
      let usedFts = true;
      try {
        rows = db.prepare(
          `SELECT cd.id, cd.title, cd.author, cd.publication_date, cd.tags,
             snippet(corpus_fts, 2, '**', '**', '…', 32) AS snippet
           FROM corpus_fts JOIN corpus_documents cd ON corpus_fts.rowid = cd.rowid
           WHERE corpus_fts MATCH ? ORDER BY rank LIMIT ?`
        ).all(query, limit) as Record<string, unknown>[];
      } catch {
        usedFts = false;
        const p = `%${query}%`;
        rows = db.prepare(
          `SELECT id, title, author, publication_date, tags, substr(content, 1, 300) AS snippet
           FROM corpus_documents WHERE title LIKE ? OR content LIKE ? OR author LIKE ? LIMIT ?`
        ).all(p, p, p, limit) as Record<string, unknown>[];
      }
      logActivityToDB({ tool: name, params, sqlPreview: usedFts ? ftsSql : `LIKE fallback: ${query}`, resultSummary: `${rows.length} result(s) for "${query}" via ${usedFts ? "FTS5" : "LIKE fallback"}` });
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    } finally { db.close(); }
  }

  // ── analyze_document ──────────────────────────────────────────────────────
  if (name === "analyze_document") {
    const { documentId, terms } = z.object({ documentId: z.string(), terms: z.array(z.string()).min(1) }).parse(params);
    const db = getDB();
    try {
      const row = db.prepare("SELECT id, title, author, publication_date, content FROM corpus_documents WHERE id = ?").get(documentId) as
        | { id: string; title: string; author: string; publication_date: string; content: string } | undefined;
      if (!row) throw new Error(`Document not found: ${documentId}`);

      const content = row.content ?? "";
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      const analysis = terms.map(term => {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const occurrences = (content.match(new RegExp(escaped, "gi")) ?? []).length;
        return { term, occurrences, passages: getPassages(content, term) };
      });

      const summary = analysis.map(a => `${a.term}: ${a.occurrences}`).join(" | ");
      logActivityToDB({ tool: name, params: { documentId, terms }, sqlPreview: `SELECT content FROM corpus_documents WHERE id = '${documentId}'`, resultSummary: `Analyzed "${row.title}" — ${summary}` });
      return { content: [{ type: "text" as const, text: JSON.stringify({ document: { id: row.id, title: row.title, author: row.author, publication_date: row.publication_date, word_count: wordCount }, analysis }, null, 2) }] };
    } finally { db.close(); }
  }

  // ── annotate_document ─────────────────────────────────────────────────────
  // Writes a first-class row to corpus_annotations (never mutates existing
  // rows — append-only CRDT). The document's tags column is updated if a new
  // tag is introduced, but existing tags are only added, never removed.
  if (name === "annotate_document") {
    const { documentId, annotation, tag, authorId, correctsId } = z.object({
      documentId:  z.string(),
      annotation:  z.string(),
      tag:         z.string().optional(),
      authorId:    z.string().optional(),  // e.g. "claude-opus-4", "gpt-4o"
      correctsId:  z.string().optional(),  // UUID of the annotation this refines
    }).parse(params);

    const db = getDB();
    try {
      const doc = db.prepare("SELECT tags FROM corpus_documents WHERE id = ?").get(documentId) as { tags: string } | undefined;
      if (!doc) throw new Error(`Document not found: ${documentId}`);

      const id = randomUUID();
      const now = Date.now();

      db.prepare(`
        INSERT INTO corpus_annotations
          (id, document_id, text, tag, author_type, author_id, corrects_id, is_dirty, last_synced_at, updated_at)
        VALUES (?, ?, ?, ?, 'llm', ?, ?, 1, NULL, ?)
      `).run(id, documentId, annotation, tag ?? null, authorId ?? null, correctsId ?? null, now);

      // Propagate new tag to the document's tag index (additive only)
      if (tag) {
        const tags: string[] = JSON.parse(doc.tags || "[]");
        if (!tags.includes(tag)) {
          tags.push(tag);
          db.prepare("UPDATE corpus_documents SET tags = ?, updated_at = ? WHERE id = ?")
            .run(JSON.stringify(tags), now, documentId);
        }
      }

      const count = (db.prepare("SELECT COUNT(*) as n FROM corpus_annotations WHERE document_id = ?").get(documentId) as { n: number }).n;
      const sql = `INSERT INTO corpus_annotations (id, document_id, text, tag, author_type, ...) VALUES ('${id}', '${documentId}', ...)`;
      logActivityToDB({
        tool: name,
        params: { documentId, annotation: annotation.slice(0, 80) + (annotation.length > 80 ? "…" : ""), tag },
        sqlPreview: sql,
        resultSummary: `LLM annotation written [id: ${id}]${tag ? ` [tag: ${tag}]` : ""} — ${count} total on document`,
      });
      pushAnnotationsBackground();
      return { content: [{ type: "text" as const, text: JSON.stringify({ id, status: "created" }) }] };
    } finally { db.close(); }
  }

  // ── list_annotations ──────────────────────────────────────────────────────
  if (name === "list_annotations") {
    const { documentId } = z.object({ documentId: z.string() }).parse(params);
    const sql = `SELECT * FROM corpus_annotations WHERE document_id = '${documentId}' ORDER BY updated_at ASC`;
    const db = getDB();
    try {
      const rows = db.prepare(
        "SELECT * FROM corpus_annotations WHERE document_id = ? ORDER BY updated_at ASC"
      ).all(documentId) as Record<string, unknown>[];
      logActivityToDB({ tool: name, params, sqlPreview: sql, resultSummary: `${rows.length} annotation(s) on document ${documentId}` });
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    } finally { db.close(); }
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ---------------------------------------------------------------------------
// Server factory — call once per transport connection
// ---------------------------------------------------------------------------

export function createMcpServer(): Server {
  const server = new Server(
    { name: "keel-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "read_recent_logs", description: "Read recent logbook entries.", inputSchema: { type: "object" as const, properties: { limit: { type: "number" } } } },
      { name: "search_logs", description: "Search logbook entries by title or body.", inputSchema: { type: "object" as const, properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "log_entry", description: "Insert a new log entry.", inputSchema: { type: "object" as const, properties: { title: { type: "string" }, body: { type: "string" }, tags: { type: "array", items: { type: "string" } }, wind_speed: { type: "number" } }, required: ["title", "body", "tags", "wind_speed"] } },
      { name: "sync_now", description: "Trigger a full push+pull sync.", inputSchema: { type: "object" as const, properties: {} } },
      { name: "remember_fact", description: "Store a fact in agent memory.", inputSchema: { type: "object" as const, properties: { key: { type: "string" }, value: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["key", "value"] } },
      { name: "recall_fact", description: "Recall a fact from agent memory by key.", inputSchema: { type: "object" as const, properties: { key: { type: "string" } }, required: ["key"] } },
      {
        name: "read_corpus",
        description: "List all corpus documents (metadata only). Use get_document for full text.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "get_document",
        description: "Fetch the full content and annotations of a corpus document by ID.",
        inputSchema: { type: "object" as const, properties: { id: { type: "string" } }, required: ["id"] },
      },
      {
        name: "search_corpus",
        description: 'Full-text search across corpus (FTS5). Supports phrases ("nature metaphor"), boolean (Kant AND sublime), prefix (philos*).',
        inputSchema: { type: "object" as const, properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
      },
      {
        name: "analyze_document",
        description: "Analyze a document for specific terms. Returns occurrence counts and passage excerpts per term — ideal for finding philosophical concepts and rhetorical patterns.",
        inputSchema: { type: "object" as const, properties: { documentId: { type: "string" }, terms: { type: "array", items: { type: "string" }, description: "Terms or phrases to search for" } }, required: ["documentId", "terms"] },
      },
      {
        name: "annotate_document",
        description:
          "Write an LLM analytical annotation to a corpus document. Each call creates a new " +
          "immutable row in corpus_annotations (append-only CRDT) — never overwrites researcher " +
          "annotations. Optionally supply authorId (model name) and correctsId (UUID of an " +
          "annotation this refines). Visible immediately in the web UI.",
        inputSchema: {
          type: "object" as const,
          properties: {
            documentId:  { type: "string" },
            annotation:  { type: "string", description: "The analytical observation or interpretation." },
            tag:         { type: "string", description: "Short classification label, e.g. 'kantian-sublime'." },
            authorId:    { type: "string", description: "Model identifier, e.g. 'claude-opus-4'." },
            correctsId:  { type: "string", description: "UUID of an existing annotation this refines." },
          },
          required: ["documentId", "annotation"],
        },
      },
      {
        name: "list_annotations",
        description:
          "List all annotations on a corpus document — both LLM-generated and human-authored. " +
          "Use this before annotating to avoid duplicating observations already made.",
        inputSchema: {
          type: "object" as const,
          properties: {
            documentId: { type: "string" },
          },
          required: ["documentId"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, (args ?? {}) as Record<string, unknown>);
  });

  return server;
}
