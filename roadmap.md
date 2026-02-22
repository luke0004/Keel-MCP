# Keel-MCP — Roadmap

---

## ✅ Phase 1 — Core sync engine

- Configurable schema system (`SyncSchema` type, `columnDefs`, `jsonFields`, `unionSetFields`)
- Generic conflict resolver: last-write-wins + union-set merge for array fields
- Supabase transport (push/pull, per-schema change tokens)
- MCP stdio server (Claude Desktop)
- CLI (`add`, `list`, `sync`)
- Agent memory tools (`remember_fact`, `recall_fact`)

---

## ✅ Phase 2 — Digital Humanities pilot

- Express web server with corpus manager UI
- Folder drag-and-drop upload (.md, .txt)
- Ingestion pipeline: YAML front-matter → upload form → filename heuristics → defaults
- SQLite FTS5 full-text search with ranked snippets
- MCP corpus tools: `read_corpus`, `get_document`, `search_corpus`, `analyze_document`, `annotate_document`, `list_annotations`
- OpenAI-compatible REST API (`GET /api/tools`, `POST /api/tools/call`)
- MCP over SSE for Open WebUI, Continue.dev, AnythingLLM
- In-browser agentic query runner (SSE-streamed tool calls, no Python needed)
- CRDT annotation model: append-only `corpus_annotations` table, LLM vs. human provenance, `corrects_id` revision chain
- Live agent activity log (cross-process via SQLite WAL)
- Delete single document / delete all corpus
- Tested end-to-end with Ollama + `qwen2.5:7b` on 108-document German musicology corpus

---

## 🔜 Phase 3 — Team collaboration

### 3a · Batch annotation
Run a single analytical query across the entire corpus in one click — the model iterates through all documents, applies `analyze_document` and `annotate_document` per document, and the activity log shows progress in real time.

- UI: "Batch Run" button with concept/tag prompt
- Backend: sequential agentic loop over all document IDs
- Rate control: configurable delay between documents to avoid Ollama overload
- Resume: skip documents that already have an annotation with the requested tag

### 3b · Supabase sync for corpus and annotations
Activate the existing sync infrastructure (SyncCoordinator + SupabaseTransport) for `corpus_documents` and `corpus_annotations`. Per-schema tokens already prevent collision between the two tables.

- Push dirty documents and annotations on every write
- Pull on startup and on demand (manual "Sync" button in UI)
- Conflict resolution: LWW for document fields, union-set for tags, append-only for annotations (no conflict possible — each row has a stable UUID)
- UI sync status badge (last synced timestamp, dirty count)

---

## 🔭 Phase 4 — Analysis depth

### 4a · Model comparison
Run two models on the same query and display their annotations side by side. Useful for comparing a local model (qwen2.5:7b) with a commercial model (Claude, Gemini) on the same corpus.

### 4b · Export
Export all annotations (+ source document metadata + passage excerpts) as:
- CSV — for Excel, SPSS, or spreadsheet workflows
- JSON — for Zotero, Atlas.ti, or custom pipelines

### 4c · Diachronic view
Filter search results and annotations by date range. Track how a concept (e.g. *das Erhabene*, *Natur*) evolves across decades within the corpus. Requires `publication_date` to be consistently filled — front-matter enforcement helps here.

### 4d · Named entity extraction
Add a dedicated MCP tool `extract_entities` that instructs the model to identify composers, critics, venues, and works as structured fields — stored as tags or in a dedicated entity table for later graph analysis.

---

## 🌐 Potential applications beyond DH

| Domain | Use case |
|---|---|
| **Historical linguistics** | Track semantic drift of terms across centuries |
| **Legal research** | Annotate case law for precedent patterns |
| **Archival science** | Bulk metadata extraction from finding aids |
| **Science journalism** | Cross-source concept mapping across press releases and papers |
| **Agent memory** | Long-term persistent memory for AI assistants, synced across devices |
| **Field research** | Offline data collection in remote locations, sync on return |
| **Technical maintenance** | Maintenance logs for infrastructure in connectivity-dead zones |
