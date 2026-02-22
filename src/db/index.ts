/**
 * DB module — re-exports for server (getDB alias).
 */

import { getDb } from "../db.js";

export const getDB = getDb;
export { getDb, DB_PATH, initSchema } from "../db.js";
