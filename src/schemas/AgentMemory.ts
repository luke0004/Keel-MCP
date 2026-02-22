import type { SyncSchema } from "../core/types.js";

export const AgentMemorySchema: SyncSchema = {
  tableName: "agent_memory",
  fields: [
    "key",           // The memory key (e.g. "user_preference_language")
    "value",         // The content (e.g. "TypeScript")
    "agent_id",      // Who wrote this? (e.g. "cursor-ai")
    "context_tags",  // Array for Union Merge
    "confidence"     // numeric
  ],
  jsonFields: ["context_tags"],
  unionSetFields: ["context_tags"], // This ensures tags from different agents merge!
  columnDefs: {
    key: "TEXT",
    value: "TEXT",
    agent_id: "TEXT",
    context_tags: "TEXT",
    confidence: "REAL"
  }
};
