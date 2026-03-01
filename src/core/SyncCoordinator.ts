import type Database from "better-sqlite3";
import { ConflictResolver } from "./ConflictResolver.js";
import type { SyncRecord, SyncSchema, Transport, FieldTimestamps } from "./types.js";

interface SyncRow {
  id: string;
  is_dirty: number;
  last_synced_at: string | null;
  field_timestamps: string | null;
  updated_at: number;
  deleted_at?: number | null;
  [key: string]: unknown;
}

export class SyncCoordinator {
  private resolver: ConflictResolver;

  constructor(
    private db: Database.Database,
    private transport: Transport,
    private schema: SyncSchema
  ) {
    this.resolver = new ConflictResolver(schema.unionSetFields);
  }

  async sync(): Promise<void> {
    await this.push();
    await this.pull();
  }

  /**
   * Push dirty entries to the remote store.
   * On success, marks each as clean and sets last_synced_at.
   */
  async push(): Promise<void> {
    // Construct SELECT query
    const fields = ["id", "updated_at", "field_timestamps", ...this.schema.fields];
    if (this.schema.deletedAtColumn) {
      fields.push(this.schema.deletedAtColumn);
    }
    const selectCols = fields.join(", ");
    // Dynamic SQL: uses schema.tableName which is safe if coming from trusted config
    const sql = `SELECT ${selectCols} FROM ${this.schema.tableName} WHERE is_dirty = 1`;
    
    const rows = this.db.prepare(sql).all() as SyncRow[];
    if (rows.length === 0) return;

    const records = rows.map((row) => this.rowToRecord(row));
    
    // Push to transport
    // Ensure updated_at is set to now for push, as we are syncing current state.
    const now = Date.now();
    const payload = records.map(r => ({ ...r, updated_at: now }));

    await this.transport.pushChanges(payload);

    // Mark clean
    const nowIso = new Date().toISOString();
    const updateSql = `UPDATE ${this.schema.tableName} SET is_dirty = 0, last_synced_at = ? WHERE id = ?`;
    const markClean = this.db.prepare(updateSql);
    
    const updates = this.db.transaction((items: SyncRecord[]) => {
      for (const item of items) {
        markClean.run(nowIso, item.id);
      }
    });
    updates(records);
  }

  /**
   * Pull remote changes and merge into SQLite using ConflictResolver.
   */
  async pull(): Promise<void> {
    // Get last token — use schema-specific key so multiple schemas don't
    // corrupt each other's sync position.
    const tokenKey = this.schema.syncTokenKey ?? "last_token";
    const tokenSql = "SELECT value FROM sync_state WHERE key = ?";
    const tokenRow = this.db.prepare(tokenSql).get(tokenKey) as { value: string | null } | undefined;
    const lastToken = Number(tokenRow?.value ?? 0) || 0;

    const incoming = await this.transport.fetchChanges(lastToken);
    if (incoming.length === 0) return;

    // Prepare local fetch query
    const fields = ["id", "updated_at", "field_timestamps", ...this.schema.fields];
    if (this.schema.deletedAtColumn) {
      fields.push(this.schema.deletedAtColumn);
    }
    const selectCols = fields.join(", ");
    const getLocal = this.db.prepare(`SELECT ${selectCols} FROM ${this.schema.tableName} WHERE id = ?`);

    // Prepare upsert query
    // INSERT INTO table (cols) VALUES (?) ON CONFLICT(id) DO UPDATE SET col=excluded.col, ...
    const upsertCols = ["id", "updated_at", "field_timestamps", "last_synced_at", "is_dirty", ...this.schema.fields];
    if (this.schema.deletedAtColumn) {
      upsertCols.push(this.schema.deletedAtColumn);
    }
    const placeholders = upsertCols.map(() => "?").join(", ");
    
    const updateSet = upsertCols
      .filter(c => c !== "id") // id is PK
      .map(c => `${c} = excluded.${c}`)
      .join(", ");

    const upsertSql = `
      INSERT INTO ${this.schema.tableName} (${upsertCols.join(", ")})
      VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET
        ${updateSet}
    `;
    const upsertStmt = this.db.prepare(upsertSql);

    let maxUpdatedAt = lastToken;
    const nowIso = new Date().toISOString();

    const processBatch = this.db.transaction((remotes: SyncRecord[]) => {
      for (const remote of remotes) {
        const localRow = getLocal.get(remote.id) as SyncRow | undefined;
        const local = localRow ? this.rowToRecord(localRow) : undefined;
        
        // Merge
        const mergeResult = local 
          ? this.resolver.merge(local, remote, local.field_timestamps ?? {}, remote.field_timestamps ?? {}) 
          : { merged: remote, timestamps: remote.field_timestamps ?? {} };
        const { merged } = mergeResult;
        
        // Convert to row
        const row = this.recordToRow(merged);
        
        // Prepare values for upsert
        // Order must match upsertCols: id, updated_at, field_timestamps, last_synced_at, is_dirty, ...fields, [deleted_at]
        const values: unknown[] = [
          row.id,
          row.updated_at,
          row.field_timestamps,
          nowIso, // last_synced_at
          0, // is_dirty
        ];
        
        for (const f of this.schema.fields) {
          values.push(row[f]);
        }
        if (this.schema.deletedAtColumn) {
          values.push(row[this.schema.deletedAtColumn]);
        }

        upsertStmt.run(...values);

        const up = Number(remote.updated_at);
        if (!Number.isNaN(up) && up > maxUpdatedAt) {
          maxUpdatedAt = up;
        }
      }
    });

    processBatch(incoming);

    // Update schema-specific token
    const saveToken = this.db.prepare(
      `INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`
    );
    saveToken.run(tokenKey, String(maxUpdatedAt), String(maxUpdatedAt));
  }

  private rowToRecord(row: SyncRow): SyncRecord {
    const ft = this.parseJson<FieldTimestamps>(row.field_timestamps as string | null);
    const record: SyncRecord = {
      id: row.id,
      updated_at: row.updated_at,
    };
    if (ft) {
      record.field_timestamps = ft;
    }

    if (this.schema.deletedAtColumn && row[this.schema.deletedAtColumn] !== undefined) {
      record.deleted_at = row[this.schema.deletedAtColumn] as number | null;
    }

    for (const field of this.schema.fields) {
      let val = row[field];
      if (this.schema.jsonFields.includes(field)) {
        val = this.parseJson(val as string | null);
      }
      record[field] = val;
    }
    return record;
  }

  private recordToRow(record: SyncRecord): Record<string, unknown> {
    const row: Record<string, unknown> = {
      id: record.id,
      updated_at: record.updated_at,
      field_timestamps: JSON.stringify(record.field_timestamps ?? {}),
    };
    if (this.schema.deletedAtColumn) {
      row[this.schema.deletedAtColumn] = record.deleted_at ?? null;
    }

    for (const field of this.schema.fields) {
      let val = record[field];
      if (this.schema.jsonFields.includes(field)) {
         val = val !== undefined ? JSON.stringify(val) : null;
      }
      row[field] = val ?? (this.schema.nullDefaults?.[field] ?? null);
    }
    return row;
  }

  private parseJson<T>(raw: string | null): T | undefined {
    if (raw == null || raw === "") return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
}
