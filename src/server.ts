/**
 * Keel MCP — stdio entry point for Claude Desktop and MCP CLI clients.
 * Tool logic lives in mcp-server.ts; this file only wires the transport.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDB, initSchema, initCorpusFTS, initActivityLog, initAnnotationsTable } from "./db/index.js";
import { LogbookSchema, CorpusSchema, AnnotationSchema } from "./schema.js";
import { AgentMemorySchema } from "./schemas/AgentMemory.js";
import { createMcpServer } from "./mcp-server.js";

// Initialize DB tables on startup
const db = getDB();
initSchema(db, LogbookSchema);
initSchema(db, AgentMemorySchema);
initSchema(db, CorpusSchema);
initCorpusFTS(db);
initActivityLog(db);
initAnnotationsTable(db, AnnotationSchema);
db.close();

const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
