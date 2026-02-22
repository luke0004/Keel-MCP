/**
 * Keel Logbook — command-line interface.
 */

import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { getDb, initSchema } from "./db.js";
import { SyncCoordinator } from "./core/SyncCoordinator.js";
import { SupabaseTransport } from "./core/SupabaseTransport.js";
import { LogbookSchema } from "./schema.js";

function parseArgs(argv: string[]): { command: string; args: string[]; flags: Record<string, string> } {
  const args = argv.slice(2);
  const command = args[0] ?? "";
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i]!.startsWith("--") && args[i]!.includes("=")) {
      const [k, v] = args[i]!.slice(2).split("=");
      flags[k ?? ""] = v ?? "";
    } else if (args[i] === "--tags" && args[i + 1]) {
      flags["tags"] = args[i + 1]!;
      i++;
    } else if (!args[i]!.startsWith("--")) {
      rest.push(args[i]!);
    }
  }
  return { command, args: rest, flags };
}

function add(title: string, body: string, tagsStr: string): void {
  const tags = tagsStr ? tagsStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const db = getDb();
  initSchema(db, LogbookSchema);
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO logbook_entries (id, title, body, tags, crew, field_timestamps, is_dirty, last_synced_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?)`
  ).run(id, title, body, JSON.stringify(tags), JSON.stringify([]), null, now);
  db.close();
  console.log("Saved locally.");
}

async function sync(): Promise<void> {
  config();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY");
    process.exit(1);
  }

  const db = getDb();
  initSchema(db, LogbookSchema);
  const transport = new SupabaseTransport(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    LogbookSchema.tableName,
    LogbookSchema.jsonFields
  );
  const coordinator = new SyncCoordinator(db, transport, LogbookSchema);
  await coordinator.sync();
  db.close();
  console.log("Sync complete.");
}

function list(): void {
  const db = getDb();
  initSchema(db, LogbookSchema);
  const rows = db.prepare(
    "SELECT id, title, body, tags, is_dirty, updated_at FROM logbook_entries ORDER BY updated_at DESC"
  ).all() as { id: string; title: string | null; body: string | null; tags: string | null; is_dirty: number; updated_at: number | null }[];
  db.close();

  if (rows.length === 0) {
    console.log("No entries.");
    return;
  }

  const col = (s: string, w: number) => s.padEnd(w).slice(0, w);
  const idW = 38;
  const titleW = 24;
  const bodyW = 36;
  const tagsW = 20;
  const dirtyW = 6;
  const dateW = 14;
  const header = [
    col("id", idW),
    col("title", titleW),
    col("body", bodyW),
    col("tags", tagsW),
    col("dirty", dirtyW),
    col("updated_at", dateW),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of rows) {
    const bodyPreview = (r.body ?? "").replace(/\s+/g, " ").slice(0, bodyW - 1);
    const tagsPreview = (r.tags ?? "[]").slice(0, tagsW - 1);
    const date = r.updated_at != null ? new Date(r.updated_at).toISOString().slice(0, 10) : "";
    console.log(
      [
        col(r.id, idW),
        col(r.title ?? "", titleW),
        col(bodyPreview, bodyW),
        col(tagsPreview, tagsW),
        col(String(r.is_dirty), dirtyW),
        col(date, dateW),
      ].join(" ")
    );
  }
}

async function main(): Promise<void> {
  const { command, args, flags } = parseArgs(process.argv);

  if (command === "add") {
    const title = args[0] ?? "";
    const body = args[1] ?? "";
    const tags = flags["tags"] ?? "";
    if (!title && !body) {
      console.error("Usage: keel add <title> <body> [--tags tag1,tag2]");
      process.exit(1);
    }
    add(title, body, tags);
    return;
  }

  if (command === "sync") {
    await sync();
    return;
  }

  if (command === "list") {
    list();
    return;
  }

  console.log("Keel Logbook");
  console.log("  add <title> <body> [--tags tag1,tag2]  Save a new entry locally.");
  console.log("  sync                                    Push and pull with remote.");
  console.log("  list                                    Show all entries.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
