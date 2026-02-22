# Keel-MCP: The Offline-First AI Memory Engine

Keel-MCP is a **local-first synchronization engine** designed to give AI agents (like Claude, Cline, or custom implementations) persistent, long-term memory that works offline and syncs across devices.

It runs as a **Model Context Protocol (MCP)** server, exposing tools to read, write, and search structured data (logs, memories, facts) stored in a local SQLite database. Changes are automatically synchronized with a remote backend (currently Supabase) when online, using a robust conflict resolution strategy.

## 🚀 Why Keel-MCP?

- **Offline-First:** Your agent can read and write memories even without an internet connection. Changes sync when you're back online.
- **Agent Memory:** Acts as a "long-term memory" for AI, storing facts, preferences, and project context that persists across sessions.
- **Conflict Resolution:** Uses a "Last Write Wins" strategy with smart merging for arrays (tags, crew members) to handle concurrent edits from multiple devices.
- **Extensible:** Built on a configurable schema system, allowing you to define new data types easily.

## 🛠️ Project Status

This project is currently in **Phase 1 (Core Engine)** with initial **Phase 2 (AI Capabilities)** features implemented.

| Feature | Status | Notes |
| :--- | :--- | :--- |
| **Configurable Schema** | ✅ Implemented | Define tables and fields in `src/schema.ts` |
| **Generic Conflict Resolver** | ✅ Implemented | Handles array merging (Union Set) and field-level LWW |
| **Supabase Transport** | ✅ Implemented | Syncs with Supabase PostgreSQL |
| **MCP Interface** | ✅ Implemented | Tools: `read_recent_logs`, `search_logs`, `remember_fact`, `recall_fact` |
| **CLI Interface** | ✅ Implemented | Manual `add`, `list`, and `sync` commands |
| **Semantic Sync (Vectors)** | 🚧 Planned | Phase 2: Vector embeddings for semantic search |
| **Asset/Blob Sync** | 🚧 Planned | Phase 3: Syncing images/files |

## 📦 Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/keel-mcp.git
    cd keel-mcp
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment:**
    Create a `.env` file in the root directory with your Supabase credentials:
    ```bash
    SUPABASE_URL="https://your-project.supabase.co"
    SUPABASE_KEY="your-service-role-key"
    ```

4.  **Initialize/Sync Database:**
    Run the sync command to create the local SQLite database (`keel.db`) and pull any existing data:
    ```bash
    npm run sync
    ```

## 🖥️ Usage

### 1. With Claude Desktop (Recommended)

To let Claude access Keel-MCP, add the following to your Claude Desktop configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "keel-logbook": {
      "command": "node",
      "args": ["--import", "tsx", "/ABSOLUTE/PATH/TO/keel-mcp/src/server.ts"],
      "env": {
        "SUPABASE_URL": "your-supabase-url",
        "SUPABASE_KEY": "your-supabase-key"
      }
    }
  }
}
```
*Note: Replace `/ABSOLUTE/PATH/TO/keel-mcp` with the actual path to this repository.*

Once configured, you can ask Claude:
- "Check my logs for the last engine maintenance."
- "Remember that I prefer concise answers."
- "Add a log entry: 'Meeting with team about Phase 2'."

### 2. CLI Usage

You can also interact with the database manually via the CLI:

- **List entries:**
  ```bash
  npx tsx src/cli.ts list
  ```

- **Add an entry:**
  ```bash
  npx tsx src/cli.ts add "Title" "Body content" --tags tag1,tag2
  ```

- **Force Sync:**
  ```bash
  npm run sync
  ```

## 🏗️ Architecture

- **Core (`src/core/`)**: Contains the sync logic (`SyncCoordinator`) and conflict resolution (`ConflictResolver`).
- **Database (`src/db/`)**: Manages the local SQLite connection using `better-sqlite3`.
- **MCP Server (`src/server.ts`)**: The entry point for the Model Context Protocol, defining tools and resources.
- **Transport (`src/core/SupabaseTransport.ts`)**: Handles communication with the remote Supabase backend.
