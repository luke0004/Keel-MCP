/**
 * Shared SQLite DB access for CLI and MCP server.
 */

import path from "node:path";
import Database from "better-sqlite3";
import type { SyncSchema } from "./core/types.js";

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

export function getDb(): Database.Database {
  const db = new Database(DB_PATH);
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
