# Roadmap: Keel MCP Core (Generic)

This roadmap outlines the evolution of Keel-MCP into a generic, offline-first synchronization engine for AI agents.

## Phase 1: Abstraction (The "Generic" Engine)

1.  **Configurable Schema**
    -   Use **Zod** schema definitions for runtime validation and type inference.
    -   Allow developers to define table structures, JSON fields, and union sets dynamically.

2.  **Generic Conflict Resolver**
    -   Abstract the `UnionMerge` logic to work on any array field defined in the schema.
    -   Make conflict resolution strategies (LWW, Union, etc.) configurable per-field.

3.  **Abstract Transport**
    -   Decouple the transport layer from Supabase.
    -   Create a plugin architecture for adapters (e.g., Firebase, PouchDB, generic REST APIs).

## Phase 2: AI Capabilities (The "MCP" Engine)

4.  **Semantic Sync (Vector/Embedding Support)**
    -   **Goal:** Enable Semantic Search (Vector similarity) alongside traditional Text Search (SQL LIKE).
    -   **Implementation:**
        -   Add `vectorFields: []` to the Schema definition.
        -   Trigger hooks on SQLite writes to compute embeddings (via local ONNX model or API).
        -   Store vectors in a dedicated table/column (using `sqlite-vss` or raw arrays).
        -   Expose a `searchSemantic(query)` method in the MCP server.

5.  **"Context Window" Tools**
    -   Built-in MCP tools designed for smart context loading.
    -   Examples: "Summarize last 7 days", "Get relevant entities", "Find related conversations" (instead of just raw SQL dumps).

## Phase 3: Robustness (The "Production" Engine)

6.  **Asset/Blob Synchronization**
    -   **Goal:** Abstract the `AssetDownloadManager` logic to handle binary files (images, audio, PDFs) efficiently.
    -   **Implementation:**
        -   Define an `AssetStorage` interface (Local File System vs. S3/R2).
        -   Add `blobFields: []` to the Schema.
        -   Implement "Lazy Download": Database syncs metadata instantly; binary files download only when requested by the MCP tool.

7.  **Schema Migration System**
    -   **Goal:** Auto-migrate the local SQLite database when the developer changes the schema, preventing crashes.
    -   **Implementation:**
        -   Store a `schema_version` in the `sync_state` table.
        -   On `initDB`, compare code version vs. DB version.
        -   Automatically run necessary `ALTER TABLE` statements based on the schema definition diff.

8.  **Multi-Tenancy**
    -   Built-in support for filtering sync by `user_id` or `tenant_id`.
    -   Allow one MCP server instance to securely handle multiple user profiles.

---

# Potential Applications

If generalized, this engine could power a new class of **Stateful MCP Servers**:

### 1. The "Agent Memory" Core (Long-term AI Memory)
-   **Function:** This isn't an app for humans; it's an app for other AIs.
-   **Problem:** Current AI models (ChatGPT, Claude) forget context after the session ends.
-   **The Keel Solution:** An MCP server running locally that acts as the **Long-Term Memory** for your AI interactions. Every conversation summary, user preference, and fact learned is synced to Keel.
    -   **Offline:** The AI remembers your name and project details even without internet.
    -   **Sync:** Your "Memory" follows you from your laptop to your phone.

### 2. Personal CRM
-   **Function:** Store contacts, interaction history, and relationship notes locally.
-   **Benefit:** Agent has instant access to personal network details without API latency, syncing across devices.

### 3. Project Tracker
-   **Function:** Manage tasks, milestones, and status updates.
-   **Benefit:** Offline capability allows task management in disconnected environments, syncing when back online.

### 4. Code Snippet Library
-   **Function:** A shared repository of code patterns, configuration snippets, and reusable functions.
-   **Benefit:** Agent can "remember" and retrieve specific coding patterns preferred by the user.

### 5. Learning Memory (Knowledge Graph)
-   **Function:** A generalized "memory bank" where an agent can store facts, preferences, and learned concepts.
-   **Benefit:** Shared state across all instances of that agent, enabling continuous learning and personalization.

### 6. Scientific Fieldwork Data Collection
-   **Function:** Recording observations, environmental metrics, and samples in remote locations (e.g., rainforests, arctic regions).
-   **Benefit:** Researchers can log structured data with timestamps and geolocation without internet access. Data integrity is preserved through local storage and synced automatically when back at base, preventing data loss in harsh conditions.

### 7. Technical Maintenance (Offshore/Remote)
-   **Function:** Maintenance logs for infrastructure in connectivity-dead zones, such as offshore wind farms, oil rigs, or remote mining sites.
-   **Benefit:** Technicians can access equipment history, manuals, and log repairs on-site. The "Last Write Wins" conflict resolution ensures that logs from multiple technicians working on the same system (but different devices) are merged correctly once connectivity is restored.
