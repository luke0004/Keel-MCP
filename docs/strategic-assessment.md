# Keel — Strategic Assessment

*Written after session 8. Current state: Phase 4c complete.*

---

## What the proof-of-concept has actually proven

Eight sessions of building on top of the sync engine without it breaking is meaningful. Specifically:

- **CRDT-in-SQLite works.** LWW per field + union-set for arrays + append-only for annotations handles real conflicts without drama. Adding `CategorySchema` in session 8 synced immediately with zero changes to the sync core — that's the schema-agnostic promise keeping.
- **Local-first UX is right.** No login, no cloud dependency, instant load, sync when you want it. For a researcher working offline, this is materially better than a web app.
- **Single-file HTML scales further than expected.** ~2,900 lines and still maintainable. The constraint has forced simplicity.
- **MCP integration is low-friction.** The corpus tools (`search_corpus`, `annotate_document`, etc.) required modest effort and Claude Desktop can use them today.

---

## Where "database merger" actually stands

The **core claim** of Keel is schema-agnostic, CRDT-based merging of any local SQLite database with a remote copy. Here's the honest gap map:

| Claim | Status |
|---|---|
| Schema-agnostic sync | ✅ Proven — any `SyncSchema` table just works |
| Conflict resolution | ✅ Proven — LWW + union-set handles realistic cases |
| Offline-first | ✅ Proven — SQLite is always primary |
| Multiple remote transports | ⚠️ `Transport` interface exists, but only Supabase is implemented |
| Sync reliability | ⚠️ Push failures silently swallowed — no retry, no visibility |
| Conflict visibility | ❌ No UI or log showing what was merged or overridden |
| Multi-user sync tokens | ❌ One global token per schema — two researchers would collide |
| Peer-to-peer (SQLite ↔ SQLite) | ❌ Entirely unimplemented |
| Multi-source merging (the Strangler) | ❌ Phase 9 is theoretical — no source connectors exist |

The engine is a real engine, but it's currently running one route (local ↔ Supabase, single user). The "database merger" identity is the right vision but hasn't been stress-tested against its own hardest problems.

---

## Where MCP actually stands

The MCP server exists and works, but the tools are shallow relative to what the corpus can do.

**What Claude can do today via MCP:**
- Read, search, and write annotations
- List tags and documents

**What Claude cannot do via MCP (but the backend can):**
- KWIC concordance
- Term frequency / diachronic analysis
- Tag co-occurrence
- Document timeline
- Batch annotation with progress
- Export

The MCP is more of a CRUD wrapper than an analytical interface. For Keel to be a serious MCP — one that makes a corpus *legible* to an LLM in the research sense — it needs the analysis tools exposed as tools, not just the read/write layer.

---

## The structural gap between the three roles

Right now Keel is one codebase playing three roles that have different readiness levels:

```
Research tool    ████████░░  ~80%  (missing: PDF, export formats, batch annotation UI)
Sync engine      ████░░░░░░  ~40%  (missing: retry, conflict log, multi-user, multi-transport)
MCP interface    ███░░░░░░░  ~30%  (missing: analysis tools, agentic loops, prompt templates)
```

The research tool is closest to done and closest to real use by a real researcher. The sync engine has the right architecture but hasn't been proven under the conditions it was designed for. The MCP is structurally correct but thin.

---

## What would make each role credible

**To close the research tool:**
- Phase 4d: CSV export + REFI-QDA (interoperability with Atlas.ti, MAXQDA — what the actual user's institution uses)
- Phase 5a: PDF upload (most of the corpus is PDFs)
- Phase 7b: Batch annotation UI (this is where AI earns its keep — not the search, the concept scan)

**To make the sync engine a real product:**
- Phase 6a: Retry queue with visible failure state — right now you can't trust a sync in a bad network
- Phase 6c: Per-user sync tokens — otherwise two-researcher collaboration is broken by design
- A second Transport (even a SQLite-to-SQLite transport) — proves the interface isn't just Supabase glue

**To make the MCP worth talking about:**
- Expose the analysis endpoints as tools (`run_kwic`, `get_frequency`, `get_timeline`)
- Add a `review_annotations` tool (Claude proposes, human reviews via tool response)
- The batch annotator + review mode (Phase 7b/7c) is where the MCP story becomes interesting: Claude runs a concept scan, surfaces candidates, researcher approves in the UI — that loop doesn't exist yet

---

## The honest summary

Keel is a **working research tool** and a **credible architecture sketch** for something bigger. The musicology corpus manager is genuinely useful today. The sync engine is structurally sound but hasn't been tested against its own edge cases. The MCP is a proof-of-concept in the most literal sense — it proves the concept is possible, not that it's been built.

The roadmap's instinct to let the research tool drive the design is correct. Every research tool feature (annotation, categories, frequency analysis) also sharpens the sync and MCP problems — you can't add a feature without exercising the CRDT and the tool schema. That's good architecture discipline.

The next thing that would most advance *all three roles simultaneously* is probably **Phase 7b — batch annotation UI**: it requires reliable sync (6a), exposes analysis as MCP tools (Phase 7), and completes the research workflow (4b/4c). It's the feature where all three roles have to work together.
