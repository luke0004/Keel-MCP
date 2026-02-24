# Implementation Plan: Digital Humanities Pilot (Phase 4)

## Goal
Enable scientists to upload and analyze text corpora (e.g., 19th-century musical reviews).

## Step 1: Backend Foundation (Express & SQLite)
- [ ] Install dependencies: `express`, `cors`, `multer`, `body-parser`.
- [ ] Create `src/web.ts` as the entry point for the HTTP server.
- [ ] Configure Express to share the existing SQLite connection from `src/db/index.ts`.
- [ ] Implement a basic health check endpoint `GET /health`.

## Step 2: Database Schema Extension
- [ ] Define `CorpusSchema` in `src/schema.ts`.
  - Fields: `id` (UUID), `title`, `author`, `publication_date`, `content` (TEXT), `metadata` (JSON), `tags` (JSON Array).
- [ ] Update `src/server.ts` and `src/web.ts` to initialize this schema on startup.
- [ ] Verify database migration (table creation).

## Step 3: File Upload API
- [ ] Implement `POST /api/upload` endpoint.
- [ ] Configure `multer` for temporary file storage or direct stream processing.
- [ ] Create a `IngestionService` class to:
  - Read the uploaded file.
  - Extract basic metadata (filename, size).
  - Insert a record into the `corpus` table.

## Step 4: Frontend "Upload & View" POC
- [ ] Create a `public/` directory for static assets.
- [ ] Create `index.html` with a simple File Upload form.
- [ ] Create `dashboard.html` to list uploaded documents (fetching from `GET /api/documents`).
- [ ] Add basic styling (CSS).

## Step 5: Integration with MCP
- [ ] Add `read_corpus` tool to `src/server.ts`.
- [ ] Add `search_corpus` tool to `src/server.ts` (using SQL `LIKE`).
- [ ] Test that an AI agent can read the uploaded documents.

## Step 6: Analytic Features (MVP)
- [ ] Add a "Search" bar in the frontend.
- [ ] Implement `GET /api/search?q=...` endpoint.
- [ ] (Optional) Add a button to trigger an "Analysis" via an MCP tool call (simulated or real).

## Technical Considerations
- **Concurrency**: Ensure `better-sqlite3` is used safely. The Web Server and MCP Server will likely run as separate processes (or one Node process spawning the other?).
  - *Better Approach:* Run them in the *same* Node.js process if possible, or use WAL mode for multi-process access.
  - *Recommendation:* Create a single entry point `src/main.ts` that starts *both* the MCP Server (stdio) and the Express Server (HTTP). This avoids lock contention and simplifies deployment.
