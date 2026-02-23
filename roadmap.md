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

## ✅ Phase 2 — Digital Humanities pilot (PoC)

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
- Supabase sync activated: push/pull for `corpus_documents` and `corpus_annotations`, per-schema tokens, ↑↓ Sync button + dirty-count badge in UI
- Background push after every upload and every annotation write (db closed in `.finally()` after async push completes — not before)
- Auto-migration: `initSchema()` reads `PRAGMA table_info` and issues `ALTER TABLE ADD COLUMN` for any columns missing from older databases
- Origin: extracted and generalised from [SailorsLog](https://github.com/luke0004/SailorsLog), a Swift/CloudKit sailing logbook — the sync patterns (delta tokens, field-level timestamps, union-set merge) were battle-tested against real CloudKit edge cases before being ported here

---

## 🔜 Phase 3 — Team collaboration

### ✅ 3a · Batch annotation
Run a single analytical concept across the entire corpus in one click — the model iterates through all documents, calls `analyze_document` + `annotate_document` per document, and streams live progress via SSE.

- `POST /api/batch-run` SSE endpoint: streams `started / progress / skipped / tool_call / tool_result / error / done` events ✅
- Batch Annotate card in UI: concept + tag inputs, progress bar, live event log, running counters (✓ annotated · ⟲ skipped · ✗ errors), Stop button ✅
- Resume mode: skips documents already tagged, togglable per run ✅
- Configurable inter-document delay (0–2000 ms slider) to avoid Ollama overload ✅
- Per-document errors are caught and emitted; loop continues to next document ✅
- Calls `loadDocuments()` on completion to refresh annotation counts in the library ✅
- Configurable LLM endpoint URL + API key in both Ask the AI and Batch Annotate cards ✅
- Model datalist: local Ollama models fetched on page load; commercial fallbacks (GPT-4o, o3-mini, Claude, Gemini) hardcoded ✅

### ✅ 3b · Supabase sync for corpus and annotations
Activate the existing sync infrastructure (SyncCoordinator + SupabaseTransport) for `corpus_documents` and `corpus_annotations`. Per-schema tokens already prevent collision between the two tables.

- Push dirty documents and annotations on every write ✅
- Pull on demand via ↑↓ Sync button ✅
- Conflict resolution: LWW for document fields, union-set for tags, append-only for annotations ✅
- UI sync status badge (dirty count, last synced timestamp) ✅
- Auto-migration of missing columns on startup ✅

---

## 🔜 Phase 3c — Production robustness

### 3c · Retry queue with exponential backoff
Push failures are currently swallowed silently (`.catch(() => {})`). Dirty rows stay marked and will be retried on the next write, but there is no guarantee of when that happens and no visibility when connectivity is lost for an extended period.

- On push failure: schedule retry after 2 s → 4 s → 8 s → 16 s → give up after N attempts
- Surface persistent failures as a visible error badge in the UI
- Particularly important for the satellite/offline use case the engine is designed for

### 3d · Persistent audit log
The live activity log is capped at 100 rows for dashboard performance. For research workflows where reproducibility is a requirement, a full record of every tool call — what the model queried, what it annotated, and when — is necessary.

- Separate `agent_audit_log` table, append-only, no row limit
- Exportable as CSV or JSON
- Filterable by date range and tool name in the UI

---

## 🔜 Phase 3e — Config-driven UI & Visual Schema Builder

The sync engine and MCP tools are already discipline-agnostic. The only thing hardcoded to the Digital Humanities pilot is `public/index.html` — the upload form fields, document table columns, and search facets. This phase decouples the UI from any specific domain.

### 3e · ProjectConfig layer

Extend `SyncSchema` with UI metadata into a `ProjectConfig` type. The server exposes `GET /api/config`; the frontend reads it at init and renders dynamically — no HTML changes per discipline.

```ts
interface FieldConfig {
  key: string
  label: string
  type: 'text' | 'date' | 'number' | 'tags' | 'textarea'
  searchable?: boolean    // appears in search facets / filters
  showInList?: boolean    // appears in document table columns
  showInForm?: boolean    // appears in upload / edit form
  required?: boolean
}

interface ProjectConfig {
  name: string
  description: string
  agentPromptHint: string       // prefilled into the "Ask the AI" system prompt
  schema: SyncSchema
  fields: FieldConfig[]
  acceptedFileTypes: string[]   // e.g. ['.md', '.txt', '.pdf']
}
```

- Ship example configs for two disciplines: `schemas/Musicology.ts` (existing PoC) and `schemas/LegalResearch.ts`
- Server selects config from env var or `keel.config.json` at startup
- New discipline = new config file; zero HTML changes

### 3f · Visual schema builder

A settings panel in the web UI that reads and writes `ProjectConfig` — no file editing required. Designed for researchers, not developers.

- **Field list**: shows all current fields with their type and UI toggles
- **Add field**: name input + type dropdown (text / date / number / tags / textarea) + toggles
- **Edit label / toggles**: safe at any time — UI metadata only, no DB change
- **Field locking**: fields with existing data are locked for rename/delete; only label and toggle edits allowed (prevents accidental data loss)
- **Save**: writes `keel.config.json`, server hot-reloads, UI re-renders

### 3g · Agent-driven schema evolution

Expose schema changes to agents via a `define_field` MCP tool:

```
define_field(name: "jurisdiction", type: "text", label: "Jurisdiction", searchable: true)
```

An agent encountering data it cannot categorize can propose a new field. The tool adds the SQLite column (auto-migration), updates `ProjectConfig`, and the agent immediately starts populating it. The schema grows organically as research deepens — no human setup required. A proposal/approval flow (human confirms before the column is created) is optional but recommended for shared projects.

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

## 🔭 Phase 5 — Outlet System

Today Keel is a closed loop: data comes in (upload, agent annotation) and stays in SQLite. The outlet system opens the other end — after every sync, registered adapters receive a `OutletEvent` and can push data anywhere. The engine never changes; only the adapters do.

### Architecture

```ts
interface OutletAdapter {
  id: string
  name: string
  handle(event: OutletEvent): Promise<void>    // event-driven (fires after sync)
}

interface OutletEvent {
  type: 'created' | 'updated' | 'deleted' | 'annotated'
  recordId: string
  record?: SyncRecord
  timestamp: Date
}
```

Two trigger modes:
- **Event-driven** — fires automatically after every write (web publishing, webhooks, live databases)
- **On-demand** — user or agent triggered (`export_pdf`, `submit_to_gbif`)

Outlets are registered at startup in `keel.config.json`. Adding a new outlet is a new adapter file — no engine changes.

### 5a · Outlet protocol + router

- `OutletRouter` dispatches `OutletEvent` to all registered adapters after each write
- Adapters run in parallel; individual failures are caught, logged, and retried independently (does not block the write path)
- Outlet registry in `keel.config.json` — enable/disable per adapter

### 5b · Webhook outlet

Generic `POST` to a configurable URL. Body: the record as JSON. Enables integration with any REST API, CI/CD pipeline, or automation tool (Zapier, Make, n8n).

```json
{ "outlet": "webhook", "url": "https://example.com/hooks/keel", "events": ["annotated"] }
```

### 5c · PDF report outlet

On-demand export triggered by the user or an agent via `export_pdf`. Generates a formatted PDF from a filtered set of documents + their annotations — useful for:
- Academic paper supplementary material
- Research reports for funders or institutions
- Offline archival of annotated corpus snapshots

Template is discipline-aware: reads `ProjectConfig.name` and field labels. Long-term: user-customisable templates per discipline.

### 5d · Web publishing outlet

Publishes the annotated corpus as a public-facing website. Syncs on every annotation write — no deploy step required.

- Generates an Astro SSR site (same pattern as the SailorsLog web layer)
- Each document becomes a page: `/{slug}` with full text, metadata, and LLM + human annotations
- Search index regenerated on sync
- Subdomain per project: `{project}.keel.io` (Keel Cloud) or self-hosted
- Draft/published toggle per document: only published documents are public

Use cases: digital humanities publications, open-access annotation datasets, collaborative research wikis.

### 5e · External database connectors

Purpose-built adapters that speak the native format of domain databases. Triggered on-demand (not automatically) to avoid submitting partial or unapproved data.

| Adapter | Target | Format | Domain |
|---|---|---|---|
| `GBIFAdapter` | [GBIF](https://www.gbif.org) | Darwin Core Archive | Ecology, marine biology |
| `iNaturalistAdapter` | [iNaturalist](https://www.inaturalist.org) | iNaturalist API | Field species observation |
| `ZoteroAdapter` | [Zotero](https://www.zotero.org) | Zotero API / BibTeX | Humanities, social sciences |
| `AtlasTiAdapter` | Atlas.ti / MAXQDA | REFI-QDA XML | Qualitative research |
| `ORCIDAdapter` | [ORCID](https://orcid.org) | ORCID API | Researcher attribution |
| `WebhookAdapter` | Any REST endpoint | JSON | Generic / custom |

**Marine biology example — the full pipeline:**
1. Field researcher uploads species observation notes offline (satellite connection)
2. Agent runs `analyze_document` + `annotate_document` → extracts species name, GPS coordinates, depth, behaviour tags
3. Researcher reviews annotations in the web UI, corrects misidentifications via human annotations
4. `submit_to_gbif` MCP tool packages approved records as Darwin Core Archive and submits to GBIF
5. `export_pdf` generates a formatted field report for the expedition funder

No manual data re-entry. The annotation work done for research *is* the submission.

---

## 🌐 Potential applications

| Domain | Schema config | Outlet adapters |
|---|---|---|
| **Musicology / DH** | composer, opus, journal, publication_date | PDF report, Zotero, web publication |
| **Legal research** | court, jurisdiction, citation, date decided | PDF brief, webhook to case management system |
| **Marine biology** | species, GPS, depth, behaviour, observer | GBIF, iNaturalist, PDF expedition report |
| **Ecology / field science** | taxon, habitat, coordinates, date, observer | GBIF, Darwin Core Archive, institutional DB |
| **Archival science** | archive, collection, box/folder, date range | Zotero, REFI-QDA, web finding aid |
| **Historical linguistics** | language, period, source, region | web publication, JSON export for R/Python |
| **Agent memory** | key, value, agent_id, context_tags | webhook to agent orchestrator, JSON backup |
| **Technical maintenance** | asset, location, fault type, technician | webhook to CMMS, PDF work order |
