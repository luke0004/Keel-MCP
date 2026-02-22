/**
 * DB module — re-exports for server (getDB alias).
 */

import { getDb } from "../db.js";

export const getDB = getDb;
export { getDb, DB_PATH, initSchema, initCorpusFTS, initActivityLog, initAnnotationsTable } from "../db.js";
