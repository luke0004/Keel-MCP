# Keel · Corpus

A personal research database that runs on your own computer.

Upload documents (`.md`, `.txt`), search them, browse by category, tag individual files, and read them — entirely offline, no cloud account needed.

---

## What it does

Keel gives you a clean three-column workspace in your browser:

| Column | Purpose |
|---|---|
| **Left — Sidebar** | Upload documents · Browse by tag |
| **Centre — Library** | All your documents, searchable and taggable |
| **Right — Reader** | Click any document title to read it here |

You can:
- **Upload** a folder of text files in one drag-and-drop
- **Search** the full text of every document (type a word and press Enter)
- **Browse by tag** — click a tag in the sidebar to filter the library
- **Tag documents** — click `+ tag` on any document row to label it; click `×` on a tag to remove it
- **Read** any document in the right panel by clicking its title

All data is stored in a single file (`keel.db`) on your computer. Nothing is sent anywhere unless you choose to enable cloud sync.

---

## Installation

You need two things installed first:

1. **Node.js** — download from [nodejs.org](https://nodejs.org) (choose the "LTS" version)
2. **Git** — download from [git-scm.com](https://git-scm.com)

Then open your **Terminal**:
- **On Mac:** open Spotlight (⌘ Space), type `Terminal`, press Enter
- **On Windows:** press the Windows key, type `cmd`, press Enter

Type these commands one at a time, pressing Enter after each:

```
git clone https://github.com/luke0004/Keel-MCP.git
cd Keel-MCP
npm install
npm run web
```

The last command starts the app. You'll see:

```
Web interface running at http://localhost:3000
```

Open **http://localhost:3000** in your browser. The app is running.

> **To stop the app:** go back to the Terminal and press `Ctrl + C`.
>
> **To start it again later:** open Terminal, type `cd Keel-MCP` then `npm run web`.

---

## Getting updates

When new features are available, you can update Keel in a few steps. Your documents and annotations are stored separately in `keel.db` and will not be affected.

**1. Stop the app** if it is running — go to the Terminal window where it is running and press `Ctrl + C`.

**2. Open Terminal and navigate to the Keel folder:**

```
cd Keel-MCP
```

**3. Download the latest version:**

```
git pull
```

You should see a list of files that were updated. If it says `Already up to date.`, you already have the latest version — nothing else to do.

**4. Install any new dependencies** (only needed if the update added new components — safe to run every time):

```
npm install
```

**5. Start the app again:**

```
npm run web
```

Then open **http://localhost:3000** as usual. The new features will be available straight away.

> **Your data is safe.** `git pull` only updates the app's code, not your database. All your uploaded documents, tags, and annotations stay exactly as they were.

---

## Uploading documents

Keel accepts `.md` (Markdown) and `.txt` (plain text) files.

Click **Upload Documents** in the left sidebar to expand the upload panel. You can:
- Drag and drop a single file or an entire folder
- Optionally fill in author, date, and tags before uploading — these will be applied to all files in that batch

If your documents have a YAML header (front-matter), Keel reads metadata from it automatically:

```
---
title: Beethoven — Ninth Symphony Review
author: E.T.A. Hoffmann
date: 1810-07-04
tags: [romantik, sublime]
---

Full text of the review…
```

If there is no header, Keel makes a best guess from the filename.

**Filename convention (optional):**

```
1810-07-04, E.T.A. Hoffmann.md   →   date: 1810-07-04 · title: E.T.A. Hoffmann
```

---

## Tagging

Tags are labels you attach to documents to group them by topic, theme, or category.

**Adding a tag:**
Find a document in the Library column. Click the small `+ tag` button at the end of its tag row. Type the tag name and press Enter.

**Removing a tag:**
Click the `×` next to any tag chip on a document row.

**Browsing by tag:**
Click any tag in the left sidebar to filter the Library to only documents with that tag. A bar at the top of the Library shows the active filter. Click `× clear` to see all documents again.

Tags from the sidebar also include tags that were extracted from `==highlighted passages==` and `#inline-tags` inside your documents at upload time.

---

## Search

Type any word or phrase into the search bar at the top of the Library column and press Enter (or click Search).

- Results are ranked by relevance
- Matching words are highlighted in yellow in the snippet
- Click a document title to read it in full

Press **Escape** or click `× clear` to return to the full library.

---

## Preparing documents with inline highlights (optional)

If you edit your documents in a Markdown editor, you can mark up passages before uploading. Keel extracts these at import time and stores them as annotations in the database.

```markdown
This passage describes ==the concept of the sublime== #sublime in Romantic music criticism.
```

- `==text==` marks a passage to highlight
- `#tag` after the `==text==` attaches a tag to that specific passage
- `#tag` anywhere in the document adds that tag to the document

---

## Cloud sync (optional)

If you want to share your corpus with collaborators or access it from another computer, you can connect a free [Supabase](https://supabase.com) project.

Create a file called `.env` in the Keel-MCP folder with:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
```

Restart the app. A **↑↓ Sync** button will appear in the header. Click it to push your data to Supabase and pull any changes from collaborators.

---

## Privacy

All your documents and annotations are stored in `keel.db` on your own computer. Nothing leaves your machine unless you configure Supabase sync above. Search queries, tag operations, and document reads never touch any external server.

---

## For developers

The backend is a TypeScript / Express / SQLite stack with no external services required.

- MCP server (stdio): `npm run mcp` — connects to Claude Desktop
- Web server: `npm run web` — starts the browser UI at `http://localhost:3000`
- MCP over SSE: `http://localhost:3000/mcp/sse` — for Open WebUI, Continue.dev, AnythingLLM

See [`roadmap.md`](roadmap.md) for the planned feature roadmap.
