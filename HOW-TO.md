# Keel-MCP — How to Use

Keel-MCP is a local research tool that lets an AI language model read, search, and annotate a corpus of historical texts — entirely on your own computer, without sending your data to any cloud service.

---

## What you need

| Requirement | Why |
|---|---|
| [Node.js 20+](https://nodejs.org) | Runs the server |
| A folder of `.md` or `.txt` files | Your corpus |
| [Ollama](https://ollama.com) *(optional)* | Run an AI model locally, no cloud account needed |
| Anthropic API key *(optional)* | Use Claude from the web UI instead of Ollama |

---

## 1 · Start the server

Open a terminal in the `keel-mcp` folder and run:

```bash
npm install       # first time only
npm run web
```

Then open **http://localhost:3000** in your browser.

---

## 2 · Pull an AI model

In a second terminal:

```bash
ollama pull qwen2.5:7b
```

This downloads a ~5 GB model optimised for tool use and multilingual texts. It runs fully offline after the initial download.

---

## 3 · Prepare your corpus files

Each file should be a plain `.md` or `.txt` file. The tool reads metadata from three places, in order of priority:

**Option A — YAML front-matter** (most reliable):

```
---
title: Review of Beethoven's Ninth Symphony
author: E.T.A. Hoffmann
publication_date: 1810-07-04
source: Allgemeine musikalische Zeitung
tags: [romanticism, sublime, beethoven]
---

Full text of the review starts here…
```

**Option B — filename convention** (automatic fallback):

```
1810-07-04, E.T.A. Hoffmann.md
```

The date prefix `YYYY-MM-DD` is extracted automatically. The remainder becomes the title.

**Option C — fill in the form** when uploading (overridden by front-matter if present).

---

## 4 · Upload the corpus

Drag your folder of files onto the **drop zone** in the browser. All `.md` and `.txt` files in the folder are imported at once. You can also add shared tags (e.g. `music criticism, 19th century`) in the form before uploading.

---

## 5 · Analyse the corpus with the AI

The web UI has two modes. No Python or terminal commands needed.

### Ask the AI — exploratory queries

Open the **Ask the AI** card (left column). Type a free-form research question and click **▶ Run**. The model will search and read the corpus using its tools and write targeted annotations where relevant.

**Choose your model** using the preset buttons above the fields:

| Preset | What it uses |
|---|---|
| **Ollama (local)** | Local model via Ollama — no cloud, no cost |
| **Claude (Anthropic)** | `claude-haiku-4-5-20251001` via Anthropic API — paste your `sk-ant-…` key |
| **OpenAI** | `gpt-4o-mini` via OpenAI API — paste your `sk-…` key |

Example question (German corpus):
> *Suche nach 'das Erhabene' und annotiere die drei bedeutendsten Stellen.*

### Batch Annotate — systematic sweeps

Open the **Batch Annotate** card. Enter a **Concept** (what to look for) and a **Tag** (applied to every annotation). The model processes every document in the corpus in sequence.

- The **Skip docs already annotated with this tag** checkbox lets you resume an interrupted run safely.
- Use the **Delay** slider to throttle requests when using a cloud API with rate limits.
- A progress bar and live log show status per document.

This is the right tool for systematic, reproducible analysis — e.g. sweeping the entire corpus for a single concept.

---

## 6 · Review annotations

The **middle column** of the workspace shows all pending LLM annotations for human review.

For each annotation you can:

| Action | Result |
|---|---|
| **✓ Accept** | Marks the annotation as accepted — it stays in the dataset |
| **✏ Edit** | Opens a text field — save a corrected version as a human annotation linked to the original |
| **✗ Reject** | Marks the annotation as rejected — excluded from analysis |
| **⊞ View** | Loads the full source document in the right column |

The **right column** (Source Document) shows the full text of the selected document. If the annotation text appears verbatim in the source, it is highlighted in yellow so you can immediately judge it in context.

Filter the review queue by tag using the filter box at the top of the middle column.

Your decisions are stored in the `review_status` field and are never overwritten by subsequent sync or re-annotation runs.

---

## 7 · Search the corpus yourself

Use the **Search Corpus** box. The search engine supports:

| Query | Finds |
|---|---|
| `sublime` | any document containing the word |
| `"nature metaphor"` | the exact phrase |
| `Kant AND beauty` | both words in the same document |
| `philos*` | prefix wildcard (philosophy, philosophical, …) |

---

## Useful actions

| Action | How |
|---|---|
| Delete a single document | Click **Delete** next to it in the Corpus Library |
| Delete everything and start fresh | Click **Delete All** in the top-right corner |
| Watch what the AI is doing | **Live Agent Activity** panel (left column) updates in real time |
| Filter review queue by concept | Type a tag name in the filter box above the review queue |
| Read the full text of any reviewed document | Click **⊞ View** on any annotation card |
| Connect Claude Desktop | See the Claude Desktop section below |

---

## Connecting Claude Desktop

Keel-MCP can act as an MCP server for Claude Desktop, giving Claude direct access to your corpus tools in conversation.

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

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

Replace `/absolute/path/to/Keel-MCP` with the actual path on your machine. The `DATABASE_PATH` env var is required because Claude Desktop spawns the server with a different working directory.

After saving, restart Claude Desktop. Once connected, you can ask Claude directly in conversation:

> *"Durchsuche das Korpus nach 'das Erhabene' und annotiere die relevantesten Stellen mit dem Tag 'kantian-sublime'."*

---

## Syncing to Supabase (optional — for team collaboration)

Keel-MCP can sync your corpus and all annotations to a shared Supabase database so a research team can work from the same dataset.

### Create the tables in Supabase

Go to your Supabase project → **SQL editor** and run:

```sql
-- Documents
CREATE TABLE corpus_documents (
  id                TEXT PRIMARY KEY,
  title             TEXT,
  author            TEXT,
  publication_date  TEXT,
  content           TEXT,
  metadata          TEXT,
  tags              TEXT,
  field_timestamps  TEXT,
  is_dirty          INTEGER DEFAULT 1,
  last_synced_at    TEXT,
  updated_at        BIGINT
);

-- Annotations
CREATE TABLE corpus_annotations (
  id              TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL,
  text            TEXT NOT NULL,
  tag             TEXT,
  author_type     TEXT NOT NULL DEFAULT 'llm',
  author_id       TEXT,
  corrects_id     TEXT,
  field_timestamps TEXT,
  is_dirty        INTEGER DEFAULT 1,
  last_synced_at  TEXT,
  updated_at      BIGINT
);
```

### Configure the .env file

Create a `.env` file in the `keel-mcp` folder:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
```

Use the **service role key** (not the anon key) — it bypasses Row Level Security, which keeps setup simple for a trusted local server.

### Sync

Restart the server (`npm run web`) — it picks up the `.env` automatically. The **↑↓ Sync** button appears in the top-right corner of the web UI.

- The button shows how many documents/annotations are pending upload.
- Click it to push local changes and pull any changes made by collaborators.
- Every upload and every annotation also triggers a background push automatically.

---

## A note on privacy

All data stays on your machine. No text, annotation, or search query is sent to an external server unless you explicitly configure a cloud model (Claude, Gemini) instead of Ollama.
