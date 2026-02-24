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

### ✅ 3c · Annotation Review Mode, workspace, and model support

- Three-column workspace (tools · review queue · source document viewer); each column scrolls independently ✅
- Annotation Review Mode: **✓ Accept** / **✗ Reject** / **✏ Edit** on each LLM annotation; filter queue by tag; **⊞ View** loads full source document in the right column; annotated passage highlighted in yellow ✅
- `review_status` field — review decisions are never overwritten by sync or re-annotation ✅
- Anthropic Claude API support — auto-detected by `sk-ant-` key prefix or Anthropic endpoint URL ✅
- Model presets in web UI — Ollama / Claude / OpenAI one-click config; available Ollama models fetched on page load ✅

---

## 🔜 Phase 3d — Production robustness

### 3d · Retry queue with exponential backoff
Push failures are currently swallowed silently (`.catch(() => {})`). Dirty rows stay marked and will be retried on the next write, but there is no guarantee of when that happens and no visibility when connectivity is lost for an extended period.

- On push failure: schedule retry after 2 s → 4 s → 8 s → 16 s → give up after N attempts
- Surface persistent failures as a visible error badge in the UI
- Particularly important for the satellite/offline use case the engine is designed for

### 3e · Persistent audit log
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

### 3h · PDF ingestion pipeline

Most Digital Humanities and Legal documents exist only as PDFs. The current ingestion pipeline accepts `.md` and `.txt` only, which means researchers must pre-convert before upload — an unnecessary friction point that blocks adoption in the two highest-value domains.

A local-first pipeline that converts PDF to structured Markdown at upload time, with no external API calls and no data leaving the machine:

- **PDF-to-Markdown conversion** at ingest time — runs server-side on upload, before the document is written to SQLite
- **Structure preservation**: tables converted to Markdown tables, footnotes preserved as inline references, headers mapped to `#` / `##` hierarchy
- **Citation extraction**: detect and tag bibliographic references (e.g. author–date, footnote numbers) so `analyze_document` can locate them by term
- **Multi-column layout handling**: reflow two-column academic paper layouts into a single reading order before storage
- **Drag-and-drop `.pdf` support** in the upload UI alongside existing `.md` / `.txt`
- **Metadata extraction**: title, author, and date read from PDF XMP/DocInfo metadata and pre-filled into the upload form
- Candidate libraries: `pdfjs-dist` (pure JS, no native deps) for text extraction; `pdf-parse` as fallback; layout analysis via heuristic column detection

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

### 4e · Annotation Review Mode (advanced)

> **Basic version shipped in Phase 3c:** accept / reject / edit per annotation, filter by tag, view source document, `review_status` field. The items below extend this foundation.

A dedicated review UI where a researcher can rapidly triage agent annotations across the entire corpus — accepting, rejecting, or editing each one — without leaving the browser. Designed for the "batch annotate then curate" workflow: the model runs first, the human refines.

**Interface:**
- Side-by-side split: document text on the left, annotation queue on the right
- Each pending annotation shows: tag, full annotation text, passage excerpt (the text span that triggered it), model ID, and timestamp
- Three keyboard-driven actions: **Accept** (`A` or `→`) · **Reject** (`R` or `Delete`) · **Edit** (`E` — opens inline textarea, saves on `Enter`)
- Accepted annotations are marked `reviewed: true` in `corpus_annotations`; rejected annotations are soft-deleted (flagged, not removed, so sync history is preserved)
- Filter queue by tag, model, or date range — useful for reviewing a single batch run in isolation
- Progress counter: `12 / 47 reviewed` with a compact progress bar

**Fine-tuning pathway:**

Accepted annotations — where the researcher confirmed or corrected the model's output — constitute a labeled dataset of (document passage, annotation) pairs specific to the researcher's domain. Keel can export this as fine-tuning data:

- `GET /api/export/finetune?tag=kantian-sublime&format=jsonl` → OpenAI / Ollama fine-tuning JSONL
- Each row: `{ "prompt": "<passage>", "completion": "<accepted annotation>" }` (or chat format for instruction-tuned models)
- Only `reviewed: true` rows are included; edited annotations use the human-corrected text, not the original LLM output
- Enables researchers to fine-tune a smaller local model (e.g. `qwen2.5:7b`) on their own domain expertise, progressively improving batch annotation quality with each review cycle

### 4f · In-document annotation view

Today annotations live in a separate panel below the document list. This phase links every annotation back to the exact passage that triggered it — making the connection between model output and source text visible and interactive.

**Schema additions:**
- `source_passage` column in `corpus_annotations` — the verbatim sentence or span extracted by `analyze_document` that led to the annotation; stored at write time by `annotate_document`
- `confidence` column — a 0–1 score returned by the model alongside the annotation text (prompted explicitly, or derived from the passage match rank from `analyze_document`)

**Document reader:**
- Clicking a document title opens a full-text reader panel below it (or in a modal) — the complete document text, rendered as Markdown
- Annotated spans are highlighted with a dotted underline in the color of their tag; hovering reveals a tooltip with the annotation text and confidence score
- Clicking the underlined span or clicking the annotation in the list scrolls the other side to match — bidirectional linking
- Confidence is displayed as a subtle badge (e.g. `0.87`) next to the annotation tag; low-confidence annotations (<0.6) are flagged with a amber indicator to prioritise human review

**Annotation card:**
Each annotation in the side panel shows three things:
1. The annotation text (the model's interpretation)
2. The source passage in a styled blockquote — the exact sentence(s) the model read before writing the annotation
3. Confidence score + model ID + timestamp

This makes it immediately possible to judge whether the model understood the passage correctly — without opening the original document separately.

### 4g · Active learning feedback loop

4e's fine-tuning export is batch and manual — the researcher runs a review, exports JSONL, and fine-tunes offline. Active learning closes the loop incrementally: every correction the researcher makes is automatically captured as a training signal, and the local model improves continuously without a separate export step.

**How it works:**

1. The researcher edits an annotation in Review Mode (4e) — the original LLM text and the corrected human text are both stored (`corrects_id` already links them in the existing CRDT schema)
2. The correction is automatically added to a local training queue (`correction_queue` table) — no action required from the researcher
3. When the queue reaches a configurable threshold (e.g. 20 corrections), Keel prompts: *"You have 20 corrections queued. Fine-tune the local model now?"*
4. On confirmation, Keel exports the queue as JSONL and invokes the Ollama fine-tuning API (`POST /api/train`) or shells out to `ollama create` — locally, no data leaves the machine
5. The newly fine-tuned model appears in the datalist and is suggested as the default for the next batch run on the same tag
6. After training, the queue is flushed; corrections accumulate again toward the next cycle

**Why this matters:**

The correction pairs are high-signal because they capture exactly where the model fails for *this researcher's* domain and interpretive standards — not a generic benchmark. A musicologist correcting "Hanslick's use of 'erhaben' is rhetorical" to "Hanslick inverts the Kantian sublime to argue for musical autonomy" is encoding domain expertise that no pre-training dataset contains. After three or four cycles the local model begins to produce annotations in the researcher's own analytical register.

**Error pattern surfacing:**
- Group corrections by tag and model to identify systematic failure modes (e.g. the model consistently misidentifies ironic uses of *erhaben*)
- Surface these as a "Model diagnostics" panel alongside the review queue

### 4h · Corpus graph

A visual map of the corpus where relationships defined by shared tags and annotations become navigable structure. Instead of a flat list of documents, the researcher sees a topology — clusters of texts that the model has linked through a common concept, and unexpected bridges between documents that share an annotation tag but belong to different authors or decades.

**Two complementary views:**

- **Document graph** — nodes are documents (sized by annotation count), edges connect documents that share one or more annotation tags. A document heavily annotated with `kantian-sublime` and `nature-metaphor` will sit at the intersection of two visible clusters, revealing its thematic centrality within the corpus
- **Tag graph** — nodes are tags (sized by document count), edges weighted by how often two tags co-occur on the same document. Reveals which concepts travel together — e.g. if `erhabenheit` and `tonalität` frequently co-occur, a research hypothesis emerges without the researcher having to formulate it first

**Interaction:**
- Click a node to open the document or filter to all documents with that tag
- Hover an edge to see the list of shared documents or co-occurring annotations
- Filter by date range to watch the tag topology evolve diachronically (links to 4c)
- Toggle between force-directed layout (organic clustering) and timeline layout (documents ordered on a horizontal time axis, edges arcing between them)
- Nodes colored by author, tag family, or confidence quartile

**Implementation:** rendered client-side with D3.js or Cytoscape.js — no server changes needed beyond a `GET /api/graph` endpoint that returns nodes and edges derived from `corpus_annotations`.

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

## 🔭 Phase 6 — Institutional data gateway

Phases 1–5 assume data flows in one direction: a researcher uploads documents locally, annotates them, and optionally syncs to Supabase or exports to a domain database. Phase 6 inverts this. Keel becomes a gateway that reaches into existing institutional repositories — file servers, archives, document management systems — and opens their data to AI agents for the first time.

Most institutional knowledge is dark: stored on NAS drives, university file servers, or legacy content management systems, correctly preserved but never analyzed at scale. The bottleneck isn't storage or digitization — it's the absence of an AI-accessible interface. Keel fills that gap without requiring institutions to migrate or restructure their data.

### 6a · Source connectors

Pull-based ingestion adapters that connect to institutional data infrastructure. Each connector watches a source for new or changed files and ingests them into the local corpus on a schedule or on demand.

| Connector | Protocol | Common deployments |
|---|---|---|
| `FilesystemConnector` | POSIX / SMB / NFS | University NAS, research institute file shares |
| `WebDAVConnector` | WebDAV | Nextcloud, ownCloud, institutional intranets |
| `S3Connector` | S3-compatible API | AWS S3, MinIO, Wasabi, Cloudflare R2 |
| `OAIConnector` | OAI-PMH | DSpace, EPrints, Fedora Commons, institutional repositories |
| `SharePointConnector` | Microsoft Graph API | Law firms, government agencies, large universities |
| `FTPConnector` | FTP / SFTP | Legacy archives, museum digitization projects |

Connectors are configured in `keel.config.json` with credentials, polling interval, and file type filters. Ingestion runs the existing PDF pipeline (Phase 3h) automatically on binary files.

### 6b · Incremental sync

Connectors do not re-ingest the entire source on each run. They track a high-water mark (last-modified timestamp or ETag) and pull only new or changed files — the same delta-token pattern used for Supabase sync, applied to the ingestion direction.

- Deleted files at the source are soft-deleted in the corpus (flagged, not removed), preserving annotations
- Renamed or moved files are reconciled by content hash, not path, so annotations survive reorganisations
- Conflict: if a source file changes after the researcher has annotated it locally, Keel flags the document as `source_changed` and surfaces it for review

### 6c · Scheduled annotation

Combine source connectors with batch annotation (Phase 3a) into a fully automated pipeline:

1. Connector ingests new documents from the file server overnight
2. Batch annotator runs automatically on all untagged documents at a configured time
3. Researcher arrives in the morning to a populated Review Mode queue (Phase 4e) — new documents already analyzed, annotations awaiting human triage
4. Approved annotations are pushed back to Supabase (Phase 3b) and to institutional systems via Outlet adapters (Phase 5)

No manual upload step. The researcher's role shifts from data preparation to intellectual judgment.

### 6d · Bidirectional institutional sync

For institutions with write-capable APIs (SharePoint, DSpace with REST, Nextcloud), Keel can push annotations back to the source system as metadata — attaching LLM and human annotations to the original file record. The document management system becomes AI-enriched without any change to the researchers' existing workflows; they continue using the tools they know, and the AI layer is invisible infrastructure.

### 6e · AI-driven schema discovery

Legacy databases accumulate entropy. Column names are abbreviations from a system no longer in use. Patient IDs appear as `12345` in one database, `PT-12345` in another, and `0012345` in a third — the same person, three formats, no documentation explaining why. After software migrations, the people who knew the schema are retired or gone. Reverse-engineering meaning from structure alone is exactly what LLMs are good at.

**Discovery pipeline:**

1. Keel connects to the legacy database in **read-only mode** — no writes, no risk
2. An LLM samples a representative slice of each table: column names, value distributions, min/max, nullability, and 20–50 example rows
3. The model produces a candidate schema map: human-readable field labels, inferred data types, probable foreign key relationships, and detected format variants (e.g. *"patient_id appears in three formats: plain integer, `PT-` prefixed, and zero-padded — likely the same entity across three migration epochs"*)
4. The schema map is presented to the domain expert for review and correction — the expert provides ground truth, the model provides the first draft
5. Approved mappings become a `ProjectConfig` (Phase 3e) that drives ingestion and the UI — no manual config file authoring needed

**Format normalisation:**

Once the schema is understood, Keel applies normalisation rules at ingestion time — transforming `PT-12345`, `0012345`, and `12345` into a canonical form before they enter SQLite. The legacy database is never touched; all normalisation happens in the ingestion layer.

**The Strangler Pattern:**

Named after the strangler fig, which grows around an existing tree until the original is no longer load-bearing. Applied here:

1. **Wrap** — Keel deploys alongside the legacy system. All queries continue to hit the original database. Keel reads from it in parallel, building its own unified corpus
2. **Route** — new analytical queries are routed through Keel's MCP interface; the legacy system handles operational queries it was built for
3. **Enrich** — Keel's AI annotation layer adds value the legacy system never had: semantic search, cross-database linkage, LLM analysis
4. **Retire** — as confidence in Keel's unified corpus grows, the legacy system is gradually decommissioned. Migration risk is zero because nothing was migrated — the data was re-read and re-indexed rather than moved

The legacy system is never "migrated." It is made irrelevant incrementally.

### 6f · Database reanimation — a theoretical framework

> *This section describes a conceptual direction rather than a planned feature. Medical and clinical implementations in particular carry regulatory obligations — GDPR, HIPAA, MDR — that are beyond the scope of a general-purpose open-source tool. The principle is recorded here because it is architecturally sound and may inform future work or specialised forks.*

Most accumulated institutional data is not lost — it is inert. It exists in databases that are technically running, correctly backed up, and completely inaccessible to any analytical query more sophisticated than the application that created them. The software that gave the data meaning has been retired, replaced, or migrated away from, leaving behind tables whose column names are abbreviations no one remembers and whose records are linked by ID formats that shifted three times across three vendor transitions.

This is the situation facing a retiring cardiologist: decades of patient records distributed across a patient database, a PACS imaging archive (DICOM), and multiple ECG databases from different manufacturers, accumulated across equipment generations. Each system is internally consistent. Across systems, the same patient may appear as `Müller, Hans Georg`, `Hans Müller`, and `H.G. Müller`; as patient ID `00234`, `PT-234`, and `MUE-1945-234`; with date of birth `15.03.1945`, `1945-03-15`, and `450315`. No migration was ever completed. No unified view exists. By conventional means, constructing one is a multi-year project.

**The underlying principle — three problems, one engine:**

The cardiologist's situation is not unique to medicine. It is the generic condition of any institution that has outlived more than one software generation. The three problems it exemplifies are separable and general:

1. **Schema amnesia** — meaning has decoupled from structure. Column names, table relationships, and value conventions are no longer self-documenting. An LLM reading raw samples of the data can reconstruct probable meaning better than a migration consultant reading the same data cold — because the model has internalized the conventions of every domain it has been trained on. It recognizes that `GEB_DAT` is *Geburtsdatum*, that `0012345` and `PT-12345` are the same identifier in different eras, that a column of values between 40 and 180 in a cardiology context is almost certainly heart rate.

2. **Identity fragmentation** — the same real-world entity (a patient, a specimen, a legal case, a musical work) has acquired different identifiers in different systems, and no authoritative mapping exists. Classical probabilistic record linkage requires hand-tuned weights and clean training data. An LLM given two candidate records can reason about whether they represent the same entity — weighing name variants, format conventions, and domain-specific plausibility — and return a confidence score with an explanation. The human resolves ambiguous cases; the model handles the volume.

3. **Query isolation** — each system can only answer questions about itself. The questions that matter — the ones that drove the data collection in the first place — span systems. A cardiologist's research question joins ECG findings, imaging studies, and clinical outcomes. A legal researcher's question joins case records, statute versions, and court calendars. A musicologist's question joins manuscript sources, first editions, and contemporary reception. None of these questions can be answered by any single legacy database. They require a unified corpus.

**What Keel provides as a foundation:**

Keel does not solve these problems for any specific domain. What it provides is the substrate on which domain-specific solutions can be built:

- A corpus model that is schema-agnostic (Phase 3e's `ProjectConfig` can describe any document structure)
- An AI-driven ingestion layer that can be guided by LLM-generated schema maps (Phase 6e)
- A human-in-the-loop review interface for resolving low-confidence decisions (Phase 4e)
- An append-only annotation model that records the reasoning behind linkage decisions without overwriting source data
- A local-first architecture that keeps sensitive data within institutional boundaries

The Strangler Pattern (Phase 6e) applies here at the conceptual level too: Keel does not replace the legacy systems. It wraps them with an AI-legible interface, accumulates understanding, and makes their combined contents queryable — leaving the originals untouched until the institution is ready, if ever, to retire them.

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
| **Clinical / cardiology** | patient_id, dob, modality, study_date, findings | FHIR export, PDF case summary, anonymised research dataset |
