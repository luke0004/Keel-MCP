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

export const CorpusSchema: SyncSchema = {
  tableName: "corpus_documents",
  fields: ["title", "author", "publication_date", "content", "metadata", "tags"],
  jsonFields: ["metadata", "tags"],
  unionSetFields: [],  // tags uses LWW so deletions sync correctly
  columnDefs: {
    title: "TEXT",
    author: "TEXT",
    publication_date: "TEXT",
    content: "TEXT",
    metadata: "TEXT",
    tags: "TEXT",
  },
  syncTokenKey: "last_token_corpus_documents",
};

/**
 * Annotations are append-only (CRDT): each annotation is a separate row
 * with a stable UUID.  Sync is safe with INSERT OR REPLACE because annotation
 * content never mutates after creation — the upsert is effectively a no-op
 * when the record already exists.
 *
 * syncTokenKey is scoped so annotation pulls don't advance the document token.
 */
export const AnnotationSchema: SyncSchema = {
  tableName: "corpus_annotations",
  fields: ["document_id", "text", "tag", "author_type", "author_id", "corrects_id",
           "source_passage", "start_offset", "end_offset"],
  jsonFields: [],
  unionSetFields: [],
  nullDefaults: { text: '' },  // Supabase corpus_annotations.text is NOT NULL
  columnDefs: {
    document_id:    "TEXT NOT NULL",
    text:           "TEXT",
    tag:            "TEXT",
    author_type:    "TEXT NOT NULL DEFAULT 'llm'",
    author_id:      "TEXT",
    corrects_id:    "TEXT",
    review_status:  "TEXT DEFAULT 'pending'",
    source_passage: "TEXT",
    start_offset:   "INTEGER",
    end_offset:     "INTEGER",
  },
  syncTokenKey: "last_token_corpus_annotations",
};
