# Keel — Roadmap

## What Keel is

Keel started as a **sync engine**: a way to merge a local SQLite database with a remote copy (Supabase), designed for researchers who work offline and sync when connected. That core architecture — local-first, conflict-resolving, schema-agnostic — remains the foundation of everything built on top of it.

The first application of that engine is a **corpus manager for Digital Humanities research**: upload a collection of historical texts, search them by full text and by annotation, categorise passages with tags, and build a structured record of analytical observations. The immediate user is a musicologist working with a German-language corpus of 19th-century music criticism.

**Design principles:**
- Local-first: the database is a single SQLite file on your own machine; no account or internet connection required to use it
- Human-in-the-loop: the researcher's categorisations and annotations are always primary; any automated tools are assistants, not authors
- No lock-in: data lives in open formats (SQLite, Markdown, CSV); export is always possible
- Discipline-agnostic: the sync engine and corpus model can describe any document collection, not only musicology

---

## ✅ Phase 1 — Core sync engine

- Configurable schema system (`SyncSchema` type, `columnDefs`, `jsonFields`, `unionSetFields`)
- Generic conflict resolver: last-write-wins + union-set merge for array fields
- Supabase transport (push/pull, per-schema change tokens)
- MCP stdio server (Claude Desktop)
- CLI (`add`, `list`, `sync`)
- Agent memory tools (`remember_fact`, `recall_fact`)

Origin: extracted and generalised from [SailorsLog](https://github.com/luke0004/SailorsLog), a Swift/CloudKit sailing logbook — the sync patterns (delta tokens, field-level timestamps, union-set merge) were battle-tested against real CloudKit edge cases before being ported here.

---

## ✅ Phase 2 — Digital Humanities pilot

- Express web server with corpus manager UI (three-column workspace)
- Folder drag-and-drop upload (.md, .txt)
- Ingestion pipeline: YAML front-matter → upload form → filename heuristics → defaults
- Inline markup extraction: `==highlight==` and `#tag` stored as annotations at import time
- SQLite FTS5 full-text search with ranked snippets
- MCP corpus tools: `read_corpus`, `get_document`, `search_corpus`, `analyze_document`, `annotate_document`, `list_annotations`
- OpenAI-compatible REST API (`GET /api/tools`, `POST /api/tools/call`)
- MCP over SSE for Open WebUI, Continue.dev, AnythingLLM
- In-browser agentic query runner (SSE-streamed tool calls)
- CRDT annotation model: append-only `corpus_annotations` table, LLM vs. human provenance, `corrects_id` revision chain
- Tested end-to-end with a 108-document German musicology corpus

---

## ✅ Phase 3 — Corpus UI and annotation system

The UI has been refined from a developer tool into one suitable for a non-technical researcher. AI-facing features (batch annotator, review queue, agentic runner) remain in the backend but are hidden from the main UI.

**Library (centre column):**
- Tag browser (sidebar) with frequency bars, click-to-filter
- Sort by date (asc/desc) or title (A–Z, Z–A)
- Unified search: FTS5 full-text + annotation tag/passage/note, results merged and deduplicated
- Annotation-sourced search results shown with quoted passage snippet
- Tag editing inline (add / remove without leaving the library)

**Reader (right column):**
- Text-selection annotation toolbar: select passage → assign tag + note → saved to `corpus_annotations`
- `source_passage`, `start_offset`, `end_offset` stored for precise passage linking
- Coloured highlights over annotated passages (deterministic pastel colour per tag)
- Annotation list below document body, each card showing passage, tag, and note
- Edit annotation: inline form with context preview strip (130 chars before/after, passage highlighted)
- Re-select passage: activates re-selection mode; fresh selection updates the existing annotation
- Annotations only toggle: hide document body to focus on annotation list

**Tag management:**
- Tag editor: rename or delete a tag corpus-wide from the sidebar (✎ / 🗑 buttons on hover); all `doc.tags` arrays and `annotation.tag` fields updated atomically
- Tag categories: create named, colour-coded groups; collapse/expand per group; add/remove tags from categories; `+ Category` button in the sidebar header
- `tag_categories` synced to Supabase alongside documents and annotations (`CategorySchema`, LWW on `tags` JSON field)

**Sync:**
- Push dirty documents and annotations to Supabase after every write
- Pull on demand via ↑↓ Sync button
- Conflict resolution: LWW for document fields, union-set merge for tags, append-only for annotations
- UI sync status badge (dirty count, last synced timestamp)
- Auto-migration: `initSchema()` reads `PRAGMA table_info` and adds missing columns on startup
- `nullDefaults` applied at push time so null fields satisfy remote NOT NULL constraints

**Export:**
- Zip export: one `.md` per document (YAML front-matter + body) + `annotations.csv`

---

## ✅ Phase 4 — DH Research Tools

### 4a · Search refinement ✅

- **Date range filter:** Year from/to inputs alongside the search bar, client-side filter on `publication_date`
- **Boolean tag filter:** full AND / OR / NOT expression over `#tags` (e.g. `#Erhabenheit AND NOT #Kant`)
- **KWIC (keyword in context):** `GET /api/analysis/kwic` — every occurrence of a term across the corpus with surrounding text; click a row to open that document

### 4b · Visualisation ✅

- **Document timeline:** SVG scatter plot, x = year, dot size = √(annotation count), colour = dominant tag; tooltip on hover, click to open doc; `GET /api/analysis/timeline`
- **Tag co-occurrence:** ranked list of tag pairs by shared-document count; `GET /api/analysis/cooccurrence`
- **Collocates:** most frequent neighbours of a search term (stopword-filtered); click a word to run KWIC; `GET /api/analysis/collocates`

### 4c · Statistical analysis ✅

- **Multi-series frequency chart:** term / tag / category occurrences per decade rendered as a grouped SVG bar chart; up to N series plotted simultaneously using a chip-selector UI; `GET /api/analysis/termfreq`

### 4d · Export for external DH tools 🔜

- **REFI-QDA (`.qdpx`):** standard interchange format for Atlas.ti, MAXQDA, NVivo, RQDA
- **Zotero RDF:** export document metadata as a Zotero library
- **TSV / CSV for R and Python:** annotations + document metadata in tabular form (currently: `annotations.csv` inside the zip export)
- **CSV export for frequency analyses:** "Download CSV" button on the multi-series frequency chart (decade × series columns)

---

## 🔜 Phase 5 — Content and schema

### 5a · PDF ingestion

Most historical and academic documents exist only as PDFs. A local-first PDF-to-text pipeline at upload time:

- PDF text extraction server-side at upload, before storage (candidate libraries: `pdfjs-dist`, `pdf-parse`)
- Structure preservation: headers, footnotes, table of contents mapped to Markdown equivalents
- Multi-column layout reflow for two-column academic papers
- Metadata extraction: title, author, and date read from PDF XMP/DocInfo and pre-filled in the upload form
- Drag-and-drop `.pdf` support alongside `.md` / `.txt`

### 5b · Config-driven UI

The sync engine and MCP tools are discipline-agnostic. The only thing tied to musicology is `public/index.html`. This phase decouples the UI from any specific domain:

- `ProjectConfig` type extending `SyncSchema` with UI metadata (field labels, search facets, accepted file types, upload form fields)
- Server exposes `GET /api/config`; frontend reads it at boot and renders dynamically
- Ship example configs: `schemas/Musicology.ts` and `schemas/LegalResearch.ts`
- New discipline = new config file, zero HTML changes

### 5c · Visual schema builder

A settings panel in the web UI that reads and writes `ProjectConfig` — no file editing required. Designed for researchers, not developers:

- Field list with type and UI toggles
- Add / edit / lock fields (fields with existing data are locked for rename/delete to prevent data loss)
- Writes `keel.config.json`; server hot-reloads; UI re-renders

---

## 🔜 Phase 6 — Sync and collaboration

This phase refines the **original scope** of Keel: merging a local SQLite corpus with a remote copy, reliably and transparently, even across unreliable connections.

### 6a · Retry queue with exponential backoff

Push failures are currently swallowed silently. Dirty rows stay marked and retry on the next write, but there is no visibility when connectivity is lost for extended periods.

- On push failure: retry after 2 s → 4 s → 8 s → 16 s → give up after N attempts
- Surface persistent failures as a visible error badge in the UI
- Important for offline/satellite use cases the engine was designed for

### 6b · Persistent audit log

The live activity log is capped at 30 rows. For research workflows where reproducibility matters, a full record of every write is necessary:

- Separate `agent_audit_log` table, append-only, no row limit
- Exportable as CSV or JSON
- Filterable by date range and operation type

### 6c · Multi-user corpus sharing

When two researchers share a Supabase project, each works on a local copy and syncs on demand. The CRDT model (LWW + union-set for tags + append-only for annotations) already handles this correctly for most cases. Remaining gaps:

- Document deletion conflict: if researcher A deletes a document that researcher B has annotated, surface the conflict rather than silently dropping annotations
- Annotation authorship: distinguish annotations from different researchers in the UI (currently `author_id` field exists but is not displayed)
- Per-user sync tokens so two researchers can sync independently without stepping on each other's change tokens

---

## 🔭 Phase 7 — AI research assistance

AI tools will become relevant once the manual annotation layer is mature enough to benefit from pattern-finding assistance. This phase is planned but not imminent. The model is: AI surfaces candidates, human decides.

### 7a · Semantic / conceptual search

FTS5 finds exact words. A musicologist searching for "the sublime" will not find a passage using "das Erhabene" or "überwältigende Empfindung" unless they already know the right word. Embedding-based search would find conceptually similar passages across the corpus regardless of exact wording.

- Generate text embeddings for each document and annotation passage (local model via Ollama, or OpenAI embeddings)
- Store in a vector index (SQLite-vec or similar)
- Expose as a "Find similar" search mode alongside the existing FTS5 search

### 7b · Batch annotation (UI exposure)

The batch annotator already exists in the backend (`POST /api/batch-run`). A basic UI surface would let the researcher run a concept scan across the corpus without writing API calls:

- Concept and tag inputs
- Live progress bar with document-by-document status
- Results go into the standard annotation system for human review

### 7c · Annotation review mode

A dedicated triage UI for reviewing batch-generated annotations:

- Side-by-side: document text (left) + annotation queue (right)
- Accept / Reject / Edit per annotation
- Filter by tag, model, or date range
- `review_status` field prevents sync from overwriting human decisions

### 7d · Fine-tuning export

Accepted annotations — where a researcher confirmed or corrected a model's output — constitute a labeled dataset:

- `GET /api/export/finetune?tag=...&format=jsonl` → OpenAI / Ollama fine-tuning JSONL
- Only `review_status = 'accepted'` rows included; edited annotations use the human-corrected text
- Enables progressive improvement of local model quality for a specific domain

---

## 🔭 Phase 8 — Outlet system

Today Keel is a closed loop: data comes in (upload, annotation) and stays in SQLite. The outlet system opens the other end — registered adapters receive an event after every sync and can push data anywhere.

- **Webhook outlet:** generic `POST` to any URL after every write (Zapier, Make, n8n, custom pipelines)
- **PDF report outlet:** on-demand export of a filtered document set + annotations as a formatted PDF
- **Zotero / Atlas.ti / REFI-QDA adapters:** push annotations directly to the researcher's existing tools
- **Web publishing outlet:** publish the annotated corpus as a public-facing website (Astro SSR, one page per document, search index regenerated on sync)
- **External database connectors:** purpose-built adapters for GBIF (ecology), iNaturalist, ORCID, SharePoint

---

## 🔭 Phase 9 — Institutional data gateway

For institutions with existing data locked in legacy systems — university file servers, archive management systems, old research databases — Keel can act as an AI-legible interface that wraps the existing infrastructure without requiring migration.

- **Source connectors:** filesystem / SMB, WebDAV, S3, OAI-PMH, SharePoint (pull-based, incremental, delta-token tracked)
- **Schema discovery:** LLM-assisted reverse-engineering of legacy column names and ID formats; human reviews and approves the mapping; result becomes a `ProjectConfig`
- **Scheduled annotation:** overnight ingestion + batch annotation; researcher arrives to a populated review queue
- **The Strangler Pattern:** Keel deploys alongside the legacy system, builds its own unified corpus by reading from it, adds AI-enriched search and annotation, and makes the legacy system progressively irrelevant — without ever migrating or risking data loss

See the current roadmap for a detailed write-up of the cardiology / multi-database scenario and the theoretical framework for database reanimation.

---

## 🌐 Potential applications

| Domain | Primary use | Key export targets |
|---|---|---|
| **Musicology / DH** | Corpus annotation, concept tracking, diachronic analysis | REFI-QDA, Zotero, PDF report |
| **Historical linguistics** | Text passage categorisation, terminology evolution | REFI-QDA, R/Python TSV |
| **Archival science** | Finding aid enrichment, collection description | Zotero, web publication |
| **Legal research** | Case annotation, statute cross-reference | PDF brief, webhook |
| **Marine biology / ecology** | Field observation annotation | GBIF, Darwin Core Archive |
| **Agent memory** | Key-value store with context tags | Webhook, JSON backup |
| **Technical maintenance** | Asset fault logging | Webhook to CMMS |
