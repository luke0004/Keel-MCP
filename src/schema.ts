import type { SyncSchema } from "./core/types.js";

export const LogbookSchema: SyncSchema = {
  tableName: "logbook_entries",
  fields: ["title", "body", "tags", "crew", "wind_speed"],
  jsonFields: ["tags", "crew"],
  unionSetFields: ["tags", "crew"],
  columnDefs: {
    title: "TEXT",
    body: "TEXT",
    tags: "TEXT",
    crew: "TEXT",
    wind_speed: "REAL",
  },
  // deletedAtColumn: "deleted_at" // If we add soft deletes later
};
