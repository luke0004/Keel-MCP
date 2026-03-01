export type FieldTimestamps = Record<string, number | string>;

export interface SyncRecord {
  id: string;
  field_timestamps?: FieldTimestamps;
  updated_at?: number | string;
  deleted_at?: number | string | null;
  [key: string]: unknown;
}

export interface SyncSchema {
  /** The name of the table in the local SQLite database */
  tableName: string;
  /** List of content fields to sync (excluding metadata like id, updated_at, deleted_at, is_dirty, last_synced_at) */
  fields: string[];
  /** Fields that need JSON parsing/stringifying when reading/writing to DB */
  jsonFields: string[];
  /** Fields that should be merged as union sets (arrays) */
  unionSetFields: string[];
  /** SQL definitions for fields (e.g. "TEXT", "REAL") */
  columnDefs: Record<string, string>;
  /** Optional name of the deleted_at column if soft deletes are supported */
  deletedAtColumn?: string;
  /**
   * Default values to use when a field is null before pushing to remote.
   * Use for fields that are NOT NULL in the remote schema but nullable locally.
   * E.g. { text: '' } to push empty string instead of null for the text field.
   */
  nullDefaults?: Record<string, unknown>;
  /**
   * Key used to store this schema's sync token in the sync_state table.
   * Defaults to "last_token". Must be unique per schema when syncing
   * multiple schemas against the same DB so their pull positions don't collide.
   */
  syncTokenKey?: string;
}

export interface Transport {
  /**
   * Pushes a batch of changes to the remote storage.
   * @param records The records to upsert remotely.
   * @returns The number of records successfully synced.
   */
  pushChanges(records: SyncRecord[]): Promise<number>;

  /**
   * Fetches changes from the remote storage since the given token.
   * @param lastToken The token (e.g. timestamp) of the last successful sync.
   * @returns A list of changed records from the remote.
   */
  fetchChanges(lastToken: number): Promise<SyncRecord[]>;
}
