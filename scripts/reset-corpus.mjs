/**
 * One-time corpus reset: wipes local SQLite + remote Supabase tables,
 * then clears sync tokens so the next import starts clean.
 * Run: node scripts/reset-corpus.mjs
 */

import { createClient } from '@supabase/supabase-js';
import Database from 'better-sqlite3';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const DB_PATH  = resolve(__dirname, '../keel.db');
const SB_URL   = process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_KEY;

// ── 1. Local SQLite ──────────────────────────────────────────────────────────
console.log('Clearing local database…');
const db = new Database(DB_PATH);
const anns = db.prepare('DELETE FROM corpus_annotations').run();
const docs = db.prepare('DELETE FROM corpus_documents').run();
db.prepare('DELETE FROM sync_state').run();
db.close();
console.log(`  deleted ${docs.changes} documents, ${anns.changes} annotations`);
console.log('  sync tokens cleared');

// ── 2. Supabase ──────────────────────────────────────────────────────────────
if (!SB_URL || !SB_KEY) {
  console.log('No Supabase credentials found — skipping remote reset.');
  process.exit(0);
}

console.log('\nClearing Supabase tables…');
const sb = createClient(SB_URL, SB_KEY);

const { error: annErr, count: annCount } = await sb
  .from('corpus_annotations')
  .delete({ count: 'exact' })
  .neq('id', '00000000-0000-0000-0000-000000000000'); // matches all rows

const { error: docErr, count: docCount } = await sb
  .from('corpus_documents')
  .delete({ count: 'exact' })
  .neq('id', '00000000-0000-0000-0000-000000000000');

if (annErr) console.error('  annotations error:', annErr.message);
else        console.log(`  deleted ${annCount ?? '?'} remote annotations`);

if (docErr) console.error('  documents error:', docErr.message);
else        console.log(`  deleted ${docCount ?? '?'} remote documents`);

console.log('\nDone. Re-import your files via the UI.');
