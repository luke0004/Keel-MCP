# Open Source Strategy: Apache 2.0 & Business Models

This document outlines the strategy for releasing **Keel-MCP** as an Open Source project under the **Apache 2.0** license, while exploring sustainable monetization models.

## 1. Licensing Strategy: Apache 2.0

We have chosen the **Apache License, Version 2.0** for Keel-MCP.

### Why Apache 2.0?
-   **Permissive:** Allows users to freely use, modify, and distribute the software for any purpose (personal, commercial, or academic).
-   **Patent Protection:** Includes an explicit patent grant, protecting users and contributors from patent litigation.
-   **Commercial Friendly:** Unlike "copyleft" licenses (e.g., GPL), Apache 2.0 allows companies to build proprietary extensions or products on top of Keel-MCP without being forced to open-source their own code. This encourages enterprise adoption.
-   **Ecosystem Growth:** Low barrier to entry fosters a larger community of contributors and integrators.

## 2. Monetization Models

Releasing the core as open source does not preclude revenue generation. Below is a comparison of potential business models:

### A. Open Core (Recommended)

**Concept:**
-   **Core (Open Source):** The `sync-engine`, `conflict-resolver`, and basic MCP server are free (Apache 2.0).
-   **Pro/Enterprise (Proprietary):** Advanced features are paid add-ons.

**Potential "Pro" Features:**
-   **Managed Sync Backend:** A hosted SaaS alternative to self-hosting Supabase. Users pay for "zero-config" sync.
-   **Team Management:** Role-based access control (RBAC), audit logs, and organization-wide policy enforcement.
-   **Advanced Integrations:** Pre-built connectors for enterprise tools (Salesforce, Jira, SAP) or industry-specific hardware (maritime sensors, industrial IoT).
-   **Analytics Dashboard:** Visualizing data usage, sync conflicts, and agent activity.

**Pros:** clear value separation; scales well with enterprise needs.
**Cons:** Risk of "community alienation" if core features are withheld.

### B. Hosted Service (SaaS)

**Concept:**
-   The software is 100% open source.
-   Revenue comes from hosting the backend infrastructure so users don't have to.

**Offering:**
-   "Keel Cloud": A fully managed backend that replaces the need for users to set up their own Supabase instance.
-   One-click deployment of the MCP server.

**Pros:** Aligns with user convenience; no "crippleware."
**Cons:** High infrastructure costs; users can still self-host if they have the skills.

### C. Dual Licensing

**Concept:**
-   Release under a strict copyleft license (e.g., AGPL) for free use.
-   Sell a commercial license to companies who want to embed it in proprietary software.

**Analysis:**
-   *Not recommended* for this project. It creates friction for adoption and is less suitable for a tool/library like Keel-MCP that aims for broad integration.

### D. Professional Services & Support

**Concept:**
-   Selling expertise rather than software.
-   Consulting for custom integrations (e.g., for a shipping company or wind farm operator).
-   Priority support contracts with SLAs.

**Pros:** High margins on services; builds deep relationships with big customers.
**Cons:** Hard to scale (requires human hours).

## 3. Recommended Roadmap

1.  **Phase 1: Adoption (Free & Open)**
    -   Release strictly under Apache 2.0.
    -   Focus on documentation, tutorials, and community building.
    -   Goal: Become the *standard* for offline-first MCP agents.

2.  **Phase 2: "Keel Cloud" (SaaS)**
    -   Launch a managed backend service ($5-20/month).
    -   Target individual developers and small teams who want "it to just work."

3.  **Phase 3: Enterprise (Open Core/Services)**
    -   As usage grows in sectors like maritime or energy, introduce enterprise contracts.
    -   Offer custom deployment, SLAs, and specialized connectors.
