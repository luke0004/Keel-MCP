# Keel-MCP

Keel-MCP is a local-first, LLM-native sync engine that lets AI agents operate on structured data offline and merge safely when connectivity returns.

Proof-of-Concept and Illustration: **A local-first AI research engine.** Upload a text corpus, connect any language model, and let it read, search, and annotate your documents — entirely on your own machine. Annotations sync to Supabase when you're ready to share with a team.

---

## What it does

Keel-MCP runs a local SQLite database and exposes it to AI models through two interfaces simultaneously:

- **MCP** (Model Context Protocol) — for Claude Desktop, Open WebUI, Continue.dev, and any MCP-compatible client
- **OpenAI-compatible REST API** — for Ollama, the Claude API, Gemini, LiteLLM, and custom Python/notebook workflows

Both interfaces share the same tool set. Switch models without changing anything else.

---

## Current features

| Feature | Status |
|---|---|
| Web corpus manager (upload, search, delete) | ✅ |
| Folder drag-and-drop upload (.md, .txt) | ✅ |
| YAML front-matter + filename metadata extraction | ✅ |
| Full-text search (SQLite FTS5, ranked results) | ✅ |
| MCP tools: `read_corpus`, `get_document`, `search_corpus`, `analyze_document`, `annotate_document`, `list_annotations` | ✅ |
| OpenAI-compatible REST API (`GET /api/tools`, `POST /api/tools/call`) | ✅ |
| MCP over SSE (Open WebUI, Continue.dev, AnythingLLM) | ✅ |
| MCP over stdio (Claude Desktop) | ✅ |
| In-browser agentic query runner — Ask the AI card (no Python needed) | ✅ |
| Batch Annotate — apply one concept to every document in a single run | ✅ |
| Annotation Review Mode — accept / reject / correct LLM annotations | ✅ |
| Three-column workspace — tools · review queue · source document viewer | ✅ |
| Anthropic Claude API support — auto-detected by endpoint URL or `sk-ant-` key prefix | ✅ |
| Model presets in UI — Ollama / Claude / OpenAI one-click config | ✅ |
| CRDT annotation model (LLM + human, append-only, never overwrites) | ✅ |
| `review_status` field — pending / accepted / rejected, safe from sync overwrites | ✅ |
| Live agent activity log (cross-process, SQLite WAL) | ✅ |
| Agent memory (`remember_fact`, `recall_fact`) | ✅ |
| Supabase sync — push/pull for corpus + annotations, dirty-count badge, ↑↓ Sync button | ✅ |
| Auto-migration of missing SQLite columns on startup | ✅ |
| Retry queue with exponential backoff for failed pushes | 🔜 |
| Persistent audit log (beyond 100-row live view) | 🔜 |

---

## Quick start

**Requirements:** Node.js 20+, [Ollama](https://ollama.com) (for local models)

```bash
git clone https://github.com/luke0004/Keel-MCP.git
cd Keel-MCP
npm install
npm run web          # starts at http://localhost:3000
```

Pull a local model:

```bash
ollama pull qwen2.5:7b   # ~5 GB, best tool-calling + multilingual
```

Open **http://localhost:3000**, upload your corpus, and ask a question in the "Ask the AI" panel.

---

## Connecting a model

### Ollama (local, no cloud, no cost)

The web interface connects to Ollama automatically at `http://localhost:11434`. Any model with tool-calling support works. Recommended: `qwen2.5:7b` (multilingual, reliable tool use on Apple Silicon).

### OpenAI-compatible REST (Claude, Gemini, LiteLLM, notebooks)

```python
from openai import OpenAI
import requests, json

client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")  # or your cloud endpoint
tools  = requests.get("http://localhost:3000/api/tools").json()["tools"]

messages = [
    {"role": "system", "content": "You are a research assistant. The corpus is in German. Write every annotation in German. Do not translate. Always use document IDs returned by search_corpus or read_corpus — never invent them. Use 1–2 keyword searches, not full sentences."},
    {"role": "user",   "content": "Search for 'erhaben' and annotate the most significant passage."},
]

for _ in range(10):
    r = client.chat.completions.create(model="qwen2.5:7b", tools=tools, messages=messages)
    msg = r.choices[0].message
    messages.append(msg)
    if not msg.tool_calls: print(msg.content); break
    for call in msg.tool_calls:
        result = requests.post("http://localhost:3000/api/tools/call",
            json={"name": call.function.name, "arguments": call.function.arguments}).json()
        messages.append({"role": "tool", "tool_call_id": call.id, "content": result["result"]})
```

### MCP clients (Claude Desktop, Open WebUI, Continue.dev)

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "keel-mcp": {
      "command": "/usr/local/bin/node",
      "args": [
        "/absolute/path/to/Keel-MCP/node_modules/.bin/tsx",
        "/absolute/path/to/Keel-MCP/src/server.ts"
      ],
      "env": {
        "DATABASE_PATH": "/absolute/path/to/Keel-MCP/keel.db"
      }
    }
  }
}
```

> **Why `DATABASE_PATH`?** Claude Desktop spawns the server with a different working directory, so the server cannot find `keel.db` by relative path. The env var overrides this.

**Open WebUI / AnythingLLM / Continue.dev** — SSE transport:
```
http://localhost:3000/mcp/sse
```

---

## Corpus preparation

Metadata priority: **front-matter > upload form > filename > defaults**

**Front-matter** (most reliable):
```markdown
---
title: Rezension der Neunten Sinfonie
author: E.T.A. Hoffmann
publication_date: 1810-07-04
source: Allgemeine musikalische Zeitung
tags: [romantik, das-erhabene, beethoven]
---

Volltext der Rezension…
```

**Filename convention** (automatic fallback):
```
1810-07-04, E.T.A. Hoffmann.md   →   date: 1810-07-04, title: E.T.A. Hoffmann
```

---

## Annotation model

Annotations are stored in a dedicated `corpus_annotations` table, separate from document content. The model is **append-only** (CRDT-safe):

- **LLM annotations** — purple in the UI, immutable after creation
- **Human annotations** — green in the UI, deletable by the researcher
- **Corrections** — a human annotation can reference an LLM annotation via `corrects_id`, creating a traceable revision chain

Neither side can overwrite the other. This makes the full annotation history reproducible and publishable.

---

## Supabase sync (optional)

Create a `.env` file to enable cloud sync:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
```

The sync engine uses per-schema server-change tokens, last-write-wins conflict resolution, and union-set merge for array fields (tags). Annotations use a separate sync token so document pulls and annotation pulls don't interfere.

Every document upload and every annotation write triggers a background push automatically. The **↑↓ Sync** button in the web UI runs a full push+pull for both tables and shows a live dirty-count badge. The schema is self-healing: missing columns are added via `ALTER TABLE` on every startup, so older `keel.db` files upgrade automatically.

**Known limitations (roadmap items):**
- Push failures are silently retried on the next write. A retry queue with exponential backoff would make this robust under extended network outages.
- The live activity log is capped at 100 rows for dashboard performance. A persistent append-only audit log is needed for reproducible research workflows.

---

## Web UI layout

The interface is a full-viewport three-column workspace:

| Column | Contents |
|---|---|
| **Left — Tools** | Upload corpus, Search, Ask the AI, Batch Annotate, Developer options, Agent Activity, Corpus Library |
| **Middle — Review** | Annotation review queue — accept / reject / correct LLM annotations |
| **Right — Viewer** | Full source document text, loaded on demand when clicking **⊞ View** on any annotation |

Each column scrolls independently. The viewer highlights the annotated passage in yellow when the annotation text matches verbatim in the source.

### Ask the AI

Type a free-form research question in the **Ask the AI** card and click **▶ Run**. The model searches and reads the corpus using its tools and writes targeted annotations where relevant. Configure the endpoint, API key, and model using the preset buttons or set them manually:

| Preset | Default model |
|---|---|
| **Ollama (local)** | `qwen2.5:7b` — no cloud, no cost |
| **Claude** | `claude-haiku-4-5-20251001` — paste your `sk-ant-…` key |
| **OpenAI** | `gpt-4o-mini` — paste your `sk-…` key |

### Batch Annotate

Enter a **Concept** (what to look for) and a **Tag** (applied to every annotation) in the **Batch Annotate** card. The model processes every document in sequence, streaming live progress via SSE. Use **Skip docs already annotated with this tag** to safely resume an interrupted run. The **Delay** slider throttles requests for cloud APIs with rate limits.

### Review Mode

The middle column shows all pending LLM annotations. For each annotation:

| Action | Result |
|---|---|
| **✓ Accept** | Marks accepted — stays in the dataset |
| **✏ Edit** | Opens a text field — save a corrected version as a human annotation linked to the original |
| **✗ Reject** | Marks rejected — excluded from analysis |
| **⊞ View** | Loads the full source document in the right column |

Filter the queue by tag using the filter box at the top. Decisions are stored in `review_status` and are never overwritten by subsequent sync or re-annotation runs.

### Search syntax

The **Search Corpus** box supports SQLite FTS5 queries:

| Query | Finds |
|---|---|
| `sublime` | any document containing the word |
| `"nature metaphor"` | the exact phrase |
| `Kant AND beauty` | both words in the same document |
| `philos*` | prefix wildcard (philosophy, philosophical, …) |

---

## Architecture

```
Browser (http://localhost:3000)
    │
    ├── POST /api/run          → Ask the AI — agentic loop (SSE stream)
    ├── POST /api/batch-run    → Batch Annotate — per-doc agentic loop (SSE stream)
    ├── GET  /api/annotations/review        → review queue
    ├── PATCH /api/annotations/:id/review   → accept / reject / edit
    ├── GET  /api/tools        → OpenAI tool schema
    ├── POST /api/tools/call   → tool execution
    ├── GET  /mcp/sse          → MCP over SSE
    └── POST /api/upload       → corpus ingestion
            │
    Express (web.ts)  — unified callLLM() adapter (OpenAI-compatible + Anthropic)
            │
    handleToolCall (mcp-server.ts)   ←── MCP stdio (server.ts)
            │
    SQLite keel.db (better-sqlite3, WAL mode)
            │
    SyncCoordinator ──→ Supabase (when .env configured)
```

---

## Project layout

```
src/
  server.ts          stdio MCP entry point (Claude Desktop)
  web.ts             Express server (web UI + REST + SSE)
  mcp-server.ts      tool logic shared by both transports
  ingestion.ts       file parsing, front-matter, filename heuristics
  schema.ts          LogbookSchema, CorpusSchema, AnnotationSchema
  activity.ts        cross-process activity log
  core/
    SyncCoordinator.ts   push/pull sync loop
    ConflictResolver.ts  LWW + union-set merge
    SupabaseTransport.ts Supabase adapter
  db/
    index.ts         SQLite init, FTS5, activity table
public/
  index.html         single-page corpus manager UI
```

---

## Privacy

All data stays on your machine. No text, annotation, or search query is sent to an external server unless you explicitly configure a cloud model (Claude, OpenAI) instead of Ollama.
