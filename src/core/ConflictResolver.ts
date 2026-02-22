import type { SyncRecord, FieldTimestamps } from "./types.js";

/**
 * Resolves conflicts between a local record and a remote record using
 * per-field Last Write Wins and optional union-set merge for arrays.
 */
export class ConflictResolver {
  private unionSetFields: Set<string>;

  constructor(unionSetFields: string[] = []) {
    this.unionSetFields = new Set(unionSetFields);
  }

  /**
   * Merge local and remote records using their respective field_timestamps.
   * Returns a new SyncRecord with merged values and updated field_timestamps.
   */
  merge(
    local: SyncRecord,
    remote: SyncRecord,
    localTimestamps: FieldTimestamps,
    remoteTimestamps: FieldTimestamps
  ): { merged: SyncRecord; timestamps: FieldTimestamps } {
    const merged: SyncRecord = { ...local, id: local.id };
    const timestamps: FieldTimestamps = { ...localTimestamps };

    // --- Tombstone / Deletion Logic ---
    const localDel = this.timestampMs(local.deleted_at);
    const remoteDel = this.timestampMs(remote.deleted_at);
    const localUpd = this.timestampMs(local.updated_at) ?? 0;
    const remoteUpd = this.timestampMs(remote.updated_at) ?? 0;

    // Default to local state (already copied via spread)

    if (remoteDel != null) {
      // Remote has a deletion timestamp.
      // If it's newer than our local effective timestamp (max of update or delete), it wins.
      const effectiveLocalTs = localDel != null && localDel > localUpd ? localDel : localUpd;
      if (remoteDel > effectiveLocalTs) {
        merged.deleted_at = remote.deleted_at!;
      }
    } else if (localDel != null) {
      // Local is deleted, Remote is NOT (explicitly).
      // Check if remote is an "Undelete" (newer update than local deletion).
      if (remoteUpd > localDel) {
        merged.deleted_at = null; // Undelete
      }
    }

    // --- Field-Level Merge ---
    const allKeys = new Set<string>([
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);

    // Exclude metadata fields from per-field merge
    const skipKeys = new Set<string>(["id", "field_timestamps", "updated_at", "deleted_at"]);

    for (const key of allKeys) {
      if (skipKeys.has(key)) continue;

      // Determine timestamps for this specific field, falling back to record updated_at
      const lTsVal = localTimestamps[key];
      const rTsVal = remoteTimestamps[key];
      
      const lTs = lTsVal !== undefined ? this.timestampMs(lTsVal) : localUpd;
      const rTs = rTsVal !== undefined ? this.timestampMs(rTsVal) : remoteUpd;

      // Handle Union Sets (Arrays like tags/crew)
      if (this.unionSetFields.has(key)) {
        const localArr = (local[key] as unknown[] | undefined) ?? [];
        const remoteArr = (remote[key] as unknown[] | undefined) ?? [];
        
        // Ensure they are arrays
        const safeLocal = Array.isArray(localArr) ? localArr : [];
        const safeRemote = Array.isArray(remoteArr) ? remoteArr : [];

        const arr = ConflictResolver.resolveUnionSet(safeLocal, safeRemote);
        (merged as Record<string, unknown>)[key] = arr;

        // Update timestamp to the newer of the two
        const best = (rTs ?? 0) > (lTs ?? 0) ? rTs : lTs;
        if (best !== undefined && best !== null) timestamps[key] = best;
        continue;
      }

      // Handle Scalar Fields (LWW)
      const localVal = local[key];
      const remoteVal = remote[key];

      if (rTs != null && (lTs == null || rTs > lTs)) {
        // Remote is newer
        (merged as Record<string, unknown>)[key] = remoteVal;
        if (rTs !== undefined) timestamps[key] = rTs;
      } else if (lTs != null && (rTs == null || lTs > rTs)) {
        // Local is newer
        (merged as Record<string, unknown>)[key] = localVal;
        if (lTs !== undefined) timestamps[key] = lTs;
      } else if (lTs != null && rTs != null && lTs === rTs) {
        // Tie-break
        const chosen = this.tieBreak(localVal, remoteVal);
        (merged as Record<string, unknown>)[key] = chosen;
        if (lTs !== undefined) timestamps[key] = lTs;
      } else {
        // Missing timestamps on both? Prefer remote if exists, else local.
        const val = remoteVal !== undefined ? remoteVal : localVal;
        (merged as Record<string, unknown>)[key] = val;
      }
    }

    // Update the record-level updated_at to the max of both to ensure consistency
    const maxTs = Math.max(localUpd, remoteUpd);
    merged.updated_at = maxTs;
    merged.field_timestamps = timestamps;

    return { merged, timestamps };
  }

  private timestampMs(v: string | number | undefined | null): number | undefined {
    if (v == null) return undefined;
    if (typeof v === "number") return v;
    const n = Date.parse(v);
    return Number.isNaN(n) ? undefined : n;
  }

  /** Deterministic tie-breaker when timestamps are equal (e.g. compare string representation). */
  private tieBreak(localVal: unknown, remoteVal: unknown): unknown {
    const a = localVal == null ? "" : String(localVal);
    const b = remoteVal == null ? "" : String(remoteVal);
    return a >= b ? localVal : remoteVal;
  }

  /**
   * Merges two arrays uniquely (union), with deterministic ordering.
   * Deduplicates strings case-insensitively.
   */
  static resolveUnionSet<T>(localArr: T[], remoteArr: T[]): T[] {
    const out: T[] = [];
    const seen = new Set<string>();

    const process = (item: T) => {
      let key: string;
      if (typeof item === 'string') {
        key = item.toLowerCase();
      } else {
        key = item != null && typeof item === "object" ? JSON.stringify(item) : String(item);
      }
      
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    };

    // Add all local items first
    for (const item of localArr) process(item);
    
    // Add remote items that are not in local
    for (const item of remoteArr) process(item);

    return out;
  }
}
