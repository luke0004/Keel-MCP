# Keel · Corpus

A personal research database that runs on your own computer.

Upload your text documents, search them, organise them by category, and annotate individual passages — entirely offline, no cloud account needed. When you are ready, sync with a remote copy to share with collaborators or keep a backup.

---

## What it does

Keel gives you a three-column workspace in your browser:

| Column | Purpose |
|---|---|
| **Left — Sidebar** | Upload documents · Browse and filter by tag · Organise tags into colour-coded categories · Export or delete the corpus |
| **Centre — Library** | All your documents, with full-text search, date range filter, boolean tag filter, and sort controls |
| **Right — Reader / Research** | Read and annotate documents · Switch to the Research tab for corpus-wide analysis tools |

You can:
- **Upload** a folder of text files in one drag-and-drop
- **Search** across the full text of every document — and across your annotations
- **Filter** by date range, by a single tag (click the sidebar), or by a boolean tag expression (`#tag1 AND #tag2`, `#a OR NOT #b`)
- **Sort** the library by date (oldest or newest first) or by title (A–Z or Z–A)
- **Browse by tag** — click a tag in the sidebar to filter the library to matching documents
- **Organise tags into categories** — create colour-coded category groups in the sidebar; collapse or expand them; add or remove tags from each group
- **Rename or delete tags** corpus-wide — hover a tag in the sidebar and click ✎ to rename or 🗑 to delete; all documents and annotations update automatically
- **Tag documents** — click `+ tag` on any document row to label it; click `×` on a tag to remove it
- **Annotate passages** — select any text in the Reader to attach a category tag and an optional note
- **Edit annotations** — click the pencil icon on any annotation to revise or delete it
- **Active document** — the open document is highlighted in the Library so you always know where you are
- **Annotations only** — check the toggle in the Reader to hide the document body and focus on your annotations
- **Research tools** — switch to the Research tab in the Reader column to access corpus-wide analysis (see below)

All data is stored in a single file (`keel.db`) on your computer. Nothing leaves your machine unless you choose to enable cloud sync.

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
git clone https://github.com/luke0004/Keel.git
cd Keel
npm install
npm run web
```

The last command starts the app. You will see:

```
Web interface running at http://localhost:3000
```

Open **http://localhost:3000** in your browser. The app is running.

> **To stop the app:** go back to the Terminal and press `Ctrl + C`.

---

## Starting Keel after installation

Open Terminal and type these two commands:

```
cd Keel
npm run web
```

Then open **http://localhost:3000** in your browser.

---

---

## Getting updates

When new features are available, you can update Keel in a few steps. Your documents and annotations are stored separately in `keel.db` and will not be affected.

**1. Stop the app** if it is running — go to the Terminal window and press `Ctrl + C`.

**2. Open Terminal and navigate to the Keel folder:**

```
cd Keel
```

**3. Download the latest version:**

```
git pull
```

You will see a list of files that were updated. If it says `Already up to date.`, you already have the latest version.

**4. Install any new dependencies** (safe to run every time):

```
npm install
```

**5. Start the app again:**

```
npm run web
```

Then open **http://localhost:3000** as usual.

> **Your data is safe.** `git pull` only updates the app's code, not your database. All your uploaded documents, tags, and annotations stay exactly as they were.

---

## Uploading documents

Keel accepts `.md` (Markdown) and `.txt` (plain text) files.

Click **Upload Documents** in the left sidebar to expand the upload panel. You can:
- Drag and drop a single file or an entire folder
- Optionally fill in author, date, and tags before uploading — these apply to all files in that batch

If your documents have a YAML header (front-matter), Keel reads the metadata automatically:

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

**Adding a tag:** Find a document in the Library. Click the small `+ tag` button at the end of its tag row. Type the tag name and press Enter.

**Removing a tag:** Click the `×` next to any tag chip on a document row.

**Browsing by tag:** Click any tag in the left sidebar to filter the Library to matching documents. A bar at the top of the Library shows the active filter. Click `× clear` to see all documents again.

Tags from the sidebar also include tags that were extracted from `==highlighted passages==` and `#inline-tags` inside your documents at upload time.

---

## Annotations

Annotations let you attach a category tag and an optional note to any passage in a document — like highlighting and commenting in a PDF reader, but stored in a searchable database.

**Creating an annotation:**
Open a document in the Reader by clicking its title. Select any passage of text with your mouse. A panel appears at the top of the Reader — type a tag (required), optionally add a note, then click **Annotate** (or press Enter). Tab moves between the tag and note fields; Escape cancels.

**Viewing annotations:**
Annotated passages are highlighted in the document in a colour that corresponds to their tag. The full list of annotations appears below the document text, each card showing the passage, tag, and note.

**Editing an annotation:**
Click the pencil icon **✎** on any annotation card to open an edit form. You can:
- Change the **tag** or **note** directly in the form
- Read the **context strip** — the text immediately before and after the passage, shown in grey above the text area, so you can see the boundaries of the selection
- Click **↩ Re-select passage** to return to the document and select a new passage; the toolbar re-opens pre-filled with the existing tag and note, and saving replaces the old passage
- Click **🗑 Delete** to remove the annotation and clear its highlight from the document; if no other annotation on the document uses the same tag, the tag is also removed from the document card and the Browse by Tag sidebar; the source text is not affected

**Annotations only view:**
Check the **Annotations only** box in the top-right corner of the Reader to hide the document body and show only your annotation list. Useful when reviewing and comparing notes across a long text. The setting persists as you navigate between documents.

---

## Search

Type any word or phrase into the search bar at the top of the Library column and press Enter (or click Search).

- **Full-text search** finds matches inside the body of every document, with matching words highlighted yellow in the snippet
- **Annotation search** also finds documents by the tags, passages, and notes you have annotated — those results are shown with the annotated passage in quotation marks
- Results from both sources are merged and deduplicated automatically; clicking any result opens the full document in the Reader

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

## Research tools

Switch to the **Research** tab (top of the Reader column) to access corpus-wide analysis tools. These work on your full document collection without requiring any AI:

| Tool | What it does |
|---|---|
| **KWIC** | Keyword in context — find every occurrence of a term across the corpus with surrounding text; click any row to open that document |
| **Collocates** | Which words appear most often near a given term; click a word to run KWIC on it |
| **Frequency** | Plot term frequency, tag coverage, or category coverage per decade as a grouped bar chart — supports multiple series simultaneously using a chip selector |
| **Co-occurrence** | Which tag pairs appear together most often on the same document |
| **Timeline** | Documents plotted by year, dot size scaled to annotation count, coloured by their most frequent tag |

---

## Cloud sync (optional)

If you want to share your corpus with collaborators or access it from another computer, you can connect a free [Supabase](https://supabase.com) project.

Create a file called `.env` in the Keel folder with:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
```

Restart the app. A **↑↓ Sync** button will appear in the header. Click it to push your data to Supabase and pull any changes from collaborators. The sync engine resolves conflicts automatically: the most recent change wins for document fields; tags are merged so no label is ever lost. Tag categories (names, colours, and tag memberships) sync alongside documents and annotations.

---

## Privacy

All your documents and annotations are stored in `keel.db` on your own computer. Nothing leaves your machine unless you configure Supabase sync above. Search queries, tag operations, and document reads never touch any external server.

---

## For developers

The backend is a TypeScript / Express / SQLite stack with no external services required at runtime.

- Web server: `npm run web` — starts the browser UI at `http://localhost:3000`
- MCP server (stdio): `npm run mcp` — connects to Claude Desktop or any MCP-compatible client
- MCP over SSE: `http://localhost:3000/mcp/sse` — for Open WebUI, Continue.dev, AnythingLLM
- OpenAI-compatible REST API: `GET /api/tools` · `POST /api/tools/call`

See [`roadmap.md`](roadmap.md) for the full feature roadmap and architectural plans.

---

## License

[PolyForm Noncommercial 1.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)

Free to use, modify, and share for personal, academic, and other noncommercial purposes. Commercial use requires a separate agreement.
