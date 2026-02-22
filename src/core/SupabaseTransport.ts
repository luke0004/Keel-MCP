import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SyncRecord, Transport } from "./types.js";

export class SupabaseTransport implements Transport {
  private client: SupabaseClient;

  constructor(
    url: string,
    key: string,
    private tableName: string,
    private jsonFields: string[] = []
  ) {
    this.client = createClient(url, key);
  }

  async pushChanges(records: SyncRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    const { error } = await this.client
      .from(this.tableName)
      .upsert(records);
    
    if (error) throw error;
    return records.length;
  }

  async fetchChanges(lastToken: number): Promise<SyncRecord[]> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select("*")
      .gt("updated_at", lastToken)
      .order("updated_at", { ascending: true });

    if (error) throw error;
    
    return (data ?? []).map(row => this.normalize(row)) as SyncRecord[];
  }

  private normalize(row: Record<string, unknown>): SyncRecord {
    // Ensure field_timestamps is an object
    if (typeof row.field_timestamps === "string") {
      try {
        row.field_timestamps = JSON.parse(row.field_timestamps);
      } catch {
        row.field_timestamps = {};
      }
    } else if (!row.field_timestamps) {
      row.field_timestamps = {};
    }

    // Parse configured JSON fields if they are strings
    for (const field of this.jsonFields) {
      if (typeof row[field] === "string") {
        try {
          row[field] = JSON.parse(row[field] as string);
        } catch {
          // keep as string or set to null? keep as string usually
        }
      }
    }

    return row as unknown as SyncRecord;
  }
}
