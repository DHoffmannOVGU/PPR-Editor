---
name: React Flow PPR boundary
description: Durable boundary between the React Flow editor and the canonical PPR semantic model.
---

React Flow is an interaction and rendering layer only; the canonical Pydantic-backed PPR model remains authoritative, and graph edits must flow through the existing model mutations.

**Why:** This preserves semantic validation, persistence, JSON interchange, and future SysML v2/AutomationML mapping while allowing the graph editor to evolve independently.

**How to apply:** Add visual graph features through the adapter and React Flow state, but never make React Flow nodes or edges the source of truth for PPR meaning or persistence.

Resource hierarchy visibility is also a projection: process-linked resources, their ancestors, explicit expansions, and selected resources determine what the graph renders; hidden descendants remain canonical model data.

**Why:** Large or sparse capability trees stay readable without inventing graph semantics or dropping unlinked resources from review and persistence.

**How to apply:** Keep expansion in workspace/UI state, derive visible nodes and edges in the adapter, and keep the Resource review as the complete finite projection for roots, shared children, cycles, and standalone resources.