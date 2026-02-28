/**
 * IngestionService — parses uploaded .md / .txt files into corpus_documents rows.
 *
 * Metadata priority (highest → lowest):
 *   1. YAML front-matter in the file itself
 *   2. Form fields sent with the upload request (body.*)
 *   3. Filename heuristics (date prefix, underscore-separated words)
 *   4. Safe defaults (author: "Unknown", date: today)
 */

import { randomUUID } from 'node:crypto';
import { getDB } from './db/index.js';
import { pushDocumentsBackground, pushAnnotationsBackground } from './mcp-server.js';

interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Front-matter parser
// Handles the common `---\nkey: value\n---` format used in Markdown files.
// Supports:
//   - String values (with or without surrounding quotes)
//   - Inline arrays:  tags: [philosophy, kant, sublime]
//   - ISO dates:      publication_date: 1810-07-04
// Does NOT attempt to handle multi-line YAML values or nested objects —
// those aren't needed for corpus metadata and keeping it dependency-free
// makes the tool easy to deploy anywhere.
// ---------------------------------------------------------------------------

interface FrontMatter {
  title?: string;
  author?: string;
  publication_date?: string;
  date?: string;         // alias for publication_date
  source?: string;       // journal / publication name
  journal?: string;      // alias for source
  publication?: string;  // alias for source
  tags?: string[];
  [key: string]: string | string[] | undefined;
}

function parseFrontMatter(text: string): { meta: FrontMatter; body: string } {
  const empty = { meta: {}, body: text };

  // Must start with ---
  if (!text.startsWith('---')) return empty;
  const closeIdx = text.indexOf('\n---', 3);
  if (closeIdx === -1) return empty;

  const yamlBlock = text.slice(3, closeIdx).trim();
  // Skip past the closing --- and any trailing newline
  const body = text.slice(closeIdx + 4).replace(/^\n/, '').trim();

  const meta: FrontMatter = {};
  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const raw = line.slice(colonIdx + 1).trim();
    if (!key || !raw) continue;

    // Inline YAML array: [a, b, c]
    if (raw.startsWith('[') && raw.endsWith(']')) {
      meta[key] = raw
        .slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^['"`]|['"`]$/g, ''))
        .filter(Boolean);
    } else {
      // Strip surrounding quotes
      meta[key] = raw.replace(/^['"`]|['"`]$/g, '');
    }
  }

  return { meta, body };
}

// ---------------------------------------------------------------------------
// Filename heuristics
// Extracts a date and a human-readable title guess from the filename.
//
// Examples:
//   1810-07-04_hoffmann_beethoven-review.md  → date: 1810-07-04, title: hoffmann beethoven review
//   AMZ_1810-07_sublime-nature.md            → date: 1810-07,    title: AMZ sublime nature
//   beethoven_symphony9_review.md            → date: (none),     title: beethoven symphony9 review
// ---------------------------------------------------------------------------

interface FilenameHints {
  date?: string;
  title?: string;
}

function parseFilename(originalname: string): FilenameHints {
  // Drop extension
  const base = originalname.replace(/\.[^.]+$/, '');

  // Match ISO date patterns: YYYY-MM-DD, YYYY-MM, or bare YYYY
  const dateMatch = base.match(/\b(\d{4}(?:-\d{2}(?:-\d{2})?)?)\b/);
  const date = dateMatch?.[1];

  // Remove the date segment (and adjacent separator) to build a title guess
  const titleBase = base
    .replace(/\d{4}(?:-\d{2}(?:-\d{2})?)?[,\s_-]*/, '') // remove date + trailing separators
    .replace(/[_-]+/g, ' ')                              // underscores/hyphens → spaces
    .replace(/\s{2,}/g, ' ')                             // collapse multiple spaces
    .trim();

  return {
    ...(date ? { date } : {}),
    ...(titleBase ? { title: titleBase } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tag normalisation
// Accepts: string (comma-separated), string[], or undefined
// ---------------------------------------------------------------------------

function normaliseTags(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Inline annotation extractor
// Scans document body for ==highlight== and #tag patterns written by the
// researcher inline in their Markdown files.
//
// Pattern:  ==highlighted passage== #optional-tag
//   - highlight: ==...== (single-line, no = inside)
//   - tag:       #word directly after ==...== on the same line, OR any
//               standalone #word elsewhere in the document
//
// Returns:
//   annotations — { text, tag|null } for each ==...== found
//   inlineTags  — all unique #tags found anywhere in the body
// ---------------------------------------------------------------------------

interface InlineAnnotation {
  text: string;
  tag: string | null;
}

export function stripInlineMarkup(content: string): string {
  return content
    .replace(/==([^=\n]+?)==/g, '$1')    // ==text== → text (keep the words)
    .replace(/#([a-zA-Z][\w-]*)/g, '')   // #tag → '' (remove tag markers)
    .replace(/[ \t]{2,}/g, ' ')          // collapse any double spaces left behind
    .trimEnd();
}

function extractInlineAnnotations(content: string): {
  annotations: InlineAnnotation[];
  inlineTags: string[];
} {
  const annotations: InlineAnnotation[] = [];
  const tagSet = new Set<string>();

  // Match ==highlight== optionally followed on the same line by #tag.
  // [^=\n]+ prevents crossing line boundaries and avoids === headings.
  const highlightRe = /==([^=\n]+?)==(?:[ \t]*(#([a-zA-Z][\w-]*))?)?/g;
  let m: RegExpExecArray | null;
  while ((m = highlightRe.exec(content)) !== null) {
    const text = m[1]!.trim();
    const tag  = m[3] ?? null;
    if (text) {
      annotations.push({ text, tag });
      if (tag) tagSet.add(tag);
    }
  }

  // Collect all standalone #tags anywhere in the body.
  // #word (no space after #) — distinguishes tags from Markdown headings.
  const tagRe = /#([a-zA-Z][\w-]*)/g;
  while ((m = tagRe.exec(content)) !== null) {
    tagSet.add(m[1]!);
  }

  return { annotations, inlineTags: [...tagSet] };
}

// ---------------------------------------------------------------------------
// IngestionService
// ---------------------------------------------------------------------------

export class IngestionService {
  static async ingestFile(file: UploadedFile, formBody: Record<string, unknown>) {
    // multer decodes the multipart filename header as Latin-1; re-encode to UTF-8.
    const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const { buffer, mimetype, size } = file;

    // ── 1. Extract text content ────────────────────────────────────────────
    const isText =
      mimetype.startsWith('text/') ||
      originalname.endsWith('.md') ||
      originalname.endsWith('.txt');

    if (!isText) {
      throw new Error(`Unsupported file type: ${mimetype}. Only .md and .txt files are accepted.`);
    }

    const rawText = buffer.toString('utf-8');

    // ── 2. Parse front-matter ──────────────────────────────────────────────
    const { meta: fm, body: bodyText } = parseFrontMatter(rawText);

    // ── 3. Filename heuristics ─────────────────────────────────────────────
    const hints = parseFilename(originalname);

    // ── 4. Resolve metadata (priority: front-matter > form > filename > default) ──
    const title =
      (fm.title as string) ||
      (formBody.title as string) ||
      hints.title ||
      originalname.replace(/\.[^.]+$/, '');

    const author =
      (fm.author as string) ||
      (formBody.author as string) ||
      'Unknown';

    const publicationDate =
      (fm.publication_date as string) ||
      (fm.date as string) ||
      (formBody.publication_date as string) ||
      hints.date ||
      new Date().toISOString().slice(0, 10);

    // Source / journal — stored in metadata, not a top-level column
    const source =
      (fm.source as string) ||
      (fm.journal as string) ||
      (fm.publication as string) ||
      (formBody.source as string) ||
      undefined;

    // Tags: union of front-matter + form body tags (deduplicated)
    const fmTags = normaliseTags(fm.tags);
    const formTags = normaliseTags(formBody.tags);

    // ── 5. Content — use stripped body (front-matter removed) ─────────────
    // If no front-matter was found, bodyText === rawText (unchanged).
    const content = bodyText;

    // ── 5b. Extract inline annotations (==highlight== and #tags) ──────────
    const { annotations: inlineAnnotations, inlineTags } = extractInlineAnnotations(content);
    // Strip ==...== and #tag markers from stored content (annotations already captured)
    const cleanContent = stripInlineMarkup(content);
    // Merge inline #tags with front-matter + form tags
    const tags = [...new Set([...fmTags, ...formTags, ...inlineTags])];

    // ── 6. Metadata blob (keep everything for provenance) ─────────────────
    const metadata = {
      filename: originalname,
      mimetype,
      size,
      ingested_at: Date.now(),
      ...(source ? { source } : {}),
      // Preserve any extra front-matter keys the researcher added
      ...Object.fromEntries(
        Object.entries(fm).filter(
          ([k]) => !['title', 'author', 'publication_date', 'date', 'source', 'journal', 'publication', 'tags'].includes(k)
        )
      ),
    };

    // ── 7. Insert (document + inline annotations in one transaction) ───────
    const id  = randomUUID();
    const now = Date.now();

    const db = getDB();
    try {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO corpus_documents
            (id, title, author, publication_date, content, metadata, tags,
             field_timestamps, is_dirty, last_synced_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL, ?)
        `).run(id, title, author, publicationDate, cleanContent, JSON.stringify(metadata), JSON.stringify(tags), now);

        if (inlineAnnotations.length > 0) {
          const insertAnn = db.prepare(`
            INSERT INTO corpus_annotations
              (id, document_id, text, tag, source_passage, start_offset, end_offset,
               author_type, author_id, review_status, is_dirty, last_synced_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'human', 'inline', 'accepted', 1, NULL, ?)
          `);
          let searchFrom = 0;
          for (const ann of inlineAnnotations) {
            const start = cleanContent.indexOf(ann.text, searchFrom);
            const end   = start >= 0 ? start + ann.text.length : -1;
            insertAnn.run(
              randomUUID(), id, ann.text, ann.tag ?? null,
              ann.text,                          // source_passage = the passage itself
              start >= 0 ? start : null,
              end   >= 0 ? end   : null,
              now
            );
            if (start >= 0) searchFrom = start + 1;
          }
        }
      })();
    } finally {
      db.close();
    }

    pushDocumentsBackground();
    if (inlineAnnotations.length > 0) pushAnnotationsBackground();

    return {
      id,
      title,
      author,
      publication_date: publicationDate,
      tags,
      inline_annotations: inlineAnnotations.length,
      status: 'success',
    };
  }

  static listDocuments() {
    const db = getDB();
    try {
      return db.prepare(
        'SELECT id, title, author, publication_date, tags, updated_at FROM corpus_documents ORDER BY updated_at DESC'
      ).all();
    } finally {
      db.close();
    }
  }
}
