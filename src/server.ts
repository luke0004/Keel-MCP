/**
 * Keel MCP Server — exposes local SQLite logbook to AI agents via MCP (stdio).
 * Uses low-level Server API with ListToolsRequestSchema and CallToolRequestSchema.
 */

import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDB, initSchema } from "./db/index.js";
import { SyncCoordinator } from "./core/SyncCoordinator.js";
import { SupabaseTransport } from "./core/SupabaseTransport.js";
import { LogbookSchema } from "./schema.js";
import { AgentMemorySchema } from "./schemas/AgentMemory.js";

// Initialize DB and Create Tables
const db = getDB();
initSchema(db, LogbookSchema);
initSchema(db, AgentMemorySchema);

const server = new Server(
  { name: "keel-logbook", version: "1.0.0" },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "read_recent_logs",
      description: "Read recent logbook entries from the local database.",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: { type: "number", description: "Max number of entries to return." },
        },
      },
    },
    {
      name: "search_logs",
      description: "Search logbook entries by title or body.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search term." },
        },
        required: ["query"],
      },
    },
    {
      name: "log_entry",
      description: "Insert a new log entry and trigger a background sync.",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" },
          },
          wind_speed: { type: "number" },
        },
        required: ["title", "body", "tags", "wind_speed"],
      },
    },
    {
      name: "sync_now",
      description: "Manually trigger a full sync (push dirty entries, then pull).",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "remember_fact",
      description: "Store a fact in agent memory.",
      inputSchema: {
        type: "object" as const,
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "recall_fact",
      description: "Recall a fact from agent memory by key.",
      inputSchema: {
        type: "object" as const,
        properties: {
          key: { type: "string" },
        },
        required: ["key"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const params = (args ?? {}) as Record<string, unknown>;

  if (name === "read_recent_logs") {
    const limit = Number(params?.limit ?? 20);
    const db = getDB();
    try {
      const rows = db
        .prepare(
          `SELECT * FROM logbook_entries ORDER BY updated_at DESC LIMIT ?`
        )
        .all(limit) as Record<string, unknown>[];
      return {
        content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
      };
    } finally {
      db.close();
    }
  }

  if (name === "search_logs") {
    const query = String(params?.query ?? "");
    const db = getDB();
    try {
      const pattern = `%${query}%`;
      const rows = db
        .prepare(
          `SELECT * FROM logbook_entries WHERE title LIKE ? OR body LIKE ?`
        )
        .all(pattern, pattern) as Record<string, unknown>[];
      return {
        content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
      };
    } finally {
      db.close();
    }
  }

  if (name === "log_entry") {
    const logEntrySchema = z.object({
      title: z.string(),
      body: z.string(),
      tags: z.array(z.string()),
      wind_speed: z.number(),
    });
    const parsed = logEntrySchema.parse(params);
    const { title, body, tags, wind_speed } = parsed;

    const db = getDB();
    const id = randomUUID();
    const now = Date.now();
    try {
      db.prepare(
        `INSERT INTO logbook_entries (id, title, body, tags, crew, field_timestamps, wind_speed, is_dirty, last_synced_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)`
      ).run(
        id,
        title,
        body,
        JSON.stringify(tags),
        JSON.stringify([]),
        null,
        wind_speed,
        now
      );
    } finally {
      db.close();
    }

    // Background sync (push only)
    config();
    const db2 = getDB();
    try {
      if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
        const transport = new SupabaseTransport(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_KEY,
          LogbookSchema.tableName,
          LogbookSchema.jsonFields
        );
        const coordinator = new SyncCoordinator(db2, transport, LogbookSchema);
        coordinator.push().catch(() => {});
      }
    } finally {
      db2.close();
    }

    return {
      content: [{ type: "text" as const, text: "Log saved and syncing..." }],
    };
  }

  if (name === "sync_now") {
    config();
    const db = getDB();
    try {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
        throw new Error("Missing SUPABASE_URL or SUPABASE_KEY");
      }
      const transport = new SupabaseTransport(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_KEY,
        LogbookSchema.tableName,
        LogbookSchema.jsonFields
      );
      const coordinator = new SyncCoordinator(db, transport, LogbookSchema);
      await coordinator.sync();
    } finally {
      db.close();
    }
    return {
      content: [{ type: "text" as const, text: "Sync complete." }],
    };
  }

  if (name === "remember_fact") {
    const memorySchema = z.object({
      key: z.string(),
      value: z.string(),
      tags: z.array(z.string()).optional().default([]),
    });
    const parsed = memorySchema.parse(params);
    const { key, value, tags } = parsed;

    const db = getDB();
    const id = randomUUID();
    const now = Date.now();
    try {
      db.prepare(
        `INSERT INTO agent_memory (id, key, value, agent_id, context_tags, confidence, field_timestamps, is_dirty, last_synced_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)`
      ).run(
        id,
        key,
        value,
        "keel-mcp", // default agent id for now
        JSON.stringify(tags),
        1.0, // default confidence
        null,
        now
      );
    } finally {
      db.close();
    }

    // Sync memory
    config();
    const db2 = getDB();
    try {
      if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
        const transport = new SupabaseTransport(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_KEY,
          AgentMemorySchema.tableName,
          AgentMemorySchema.jsonFields
        );
        const coordinator = new SyncCoordinator(db2, transport, AgentMemorySchema);
        coordinator.push().catch(() => {});
      }
    } finally {
      db2.close();
    }

    return {
      content: [{ type: "text" as const, text: `Fact '${key}' remembered.` }],
    };
  }

  if (name === "recall_fact") {
    const recallSchema = z.object({
      key: z.string(),
    });
    const parsed = recallSchema.parse(params);
    const { key } = parsed;

    const db = getDB();
    try {
      const rows = db.prepare(
        "SELECT * FROM agent_memory WHERE key = ?"
      ).all(key) as Record<string, unknown>[];
      
      if (rows.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Fact not found." }],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
      };
    } finally {
      db.close();
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
