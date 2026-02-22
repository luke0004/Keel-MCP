/**
 * Shared SQLite DB access for CLI and MCP server.
 */

import path from "node:path";
import Database from "better-sqlite3";
import type { SyncSchema } from "./core/types.js";
// AnnotationSchema is imported here to keep initAnnotationsTable self-contained.
// Lazy import via function argument avoids the circular-dep risk if schema.ts
// ever imports from db.ts in future.
type AnnotationSchemaDep = SyncSchema;

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "keel.db");

export function initSchema(db: Database.Database, schema: SyncSchema) {
  const { tableName, columnDefs } = schema;
  const defs = Object.entries(columnDefs)
    .map(([col, type]) => `${col} ${type}`)
    .join(", ");

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      ${defs},
      field_timestamps TEXT,
      is_dirty INTEGER DEFAULT 1,
      last_synced_at TEXT,
      updated_at INTEGER
    );
  `);
}

/**
 * Creates the FTS5 virtual table for full-text search over corpus_documents.
 * Also installs INSERT/UPDATE/DELETE triggers to keep the index in sync.
 * Safe to call on every startup — uses IF NOT EXISTS guards.
 * Must be called AFTER initSchema(db, CorpusSchema).
 */
export function initCorpusFTS(db: Database.Database) {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS corpus_fts USING fts5(
      title,
      author,
      content,
      content='corpus_documents',
      content_rowid='rowid'
    );
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS corpus_ai AFTER INSERT ON corpus_documents BEGIN
      INSERT INTO corpus_fts(rowid, title, author, content)
      VALUES (new.rowid, new.title, new.author, new.content);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS corpus_ad AFTER DELETE ON corpus_documents BEGIN
      INSERT INTO corpus_fts(corpus_fts, rowid, title, author, content)
      VALUES ('delete', old.rowid, old.title, old.author, old.content);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS corpus_au AFTER UPDATE ON corpus_documents BEGIN
      INSERT INTO corpus_fts(corpus_fts, rowid, title, author, content)
      VALUES ('delete', old.rowid, old.title, old.author, old.content);
      INSERT INTO corpus_fts(rowid, title, author, content)
      VALUES (new.rowid, new.title, new.author, new.content);
    END;
  `);

  // Rebuild ensures the FTS index matches the content table (handles data
  // inserted before triggers existed, or after a crash).
  db.exec(`INSERT INTO corpus_fts(corpus_fts) VALUES('rebuild')`);
}

/**
 * Creates the corpus_annotations table using the shared initSchema so the
 * row layout (including field_timestamps) matches what SyncCoordinator expects.
 * Also adds a document_id index for fast per-document lookups.
 *
 * CRDT contract:
 *  - INSERT only — annotation rows are immutable after creation.
 *  - Researcher corrections create a NEW human row (corrects_id → LLM row).
 *  - Sync: upsert is safe because content never changes; same UUID → same data.
 */
export function initAnnotationsTable(db: Database.Database, schema: AnnotationSchemaDep) {
  initSchema(db, schema);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_annotations_document
      ON corpus_annotations(document_id);
  `);
}

/**
 * Creates the mcp_activity table used as the cross-process activity log.
 * Both the MCP stdio server and the Express web server share keel.db via WAL,
 * so writes from the MCP process are immediately visible to the web server.
 */
export function initActivityLog(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_activity (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      tool      TEXT NOT NULL,
      params    TEXT,
      sql_preview   TEXT,
      result_summary TEXT
    );
  `);
}

export function getDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  // Ensure sync state table exists (used for tracking sync tokens)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}

export { DB_PATH };
