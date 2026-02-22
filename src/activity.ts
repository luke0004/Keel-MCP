// Activity log — written to SQLite so both the MCP stdio process and the
// Express web process share a single live feed via WAL-mode keel.db.

import { getDb } from "./db.js";

export interface ActivityEntry {
  tool: string;
  params: Record<string, unknown>;
  sqlPreview?: string;
  resultSummary?: string;
}

/**
 * Persist one activity entry to the mcp_activity table.
 * Never throws — logging must never crash the caller.
 */
export function logActivityToDB(entry: ActivityEntry) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO mcp_activity (timestamp, tool, params, sql_preview, result_summary)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      Date.now(),
      entry.tool,
      JSON.stringify(entry.params),
      entry.sqlPreview ?? null,
      entry.resultSummary ?? null,
    );
    // Keep only the 100 most recent entries
    db.prepare(`
      DELETE FROM mcp_activity
      WHERE id NOT IN (
        SELECT id FROM mcp_activity ORDER BY timestamp DESC LIMIT 100
      )
    `).run();
    db.close();
  } catch {
    // Silently ignore — logging must never crash the server
  }
}

// ---------------------------------------------------------------------------
// Legacy in-memory log (kept for /api/activity fallback during startup before
// the DB table is ready, and for unit tests).
// ---------------------------------------------------------------------------
const activityLog: { timestamp: number; tool: string; params: unknown; result?: unknown }[] = [];

export function logActivity(tool: string, params: unknown, result?: unknown) {
  activityLog.unshift({ timestamp: Date.now(), tool, params, result });
  if (activityLog.length > 50) activityLog.pop();
}

export function getActivityLog() {
  return activityLog;
}
