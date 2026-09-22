---
name: Process specification export
description: The shareable process drawing must stay projection-driven and deterministic.
---

The Process Specification export is a self-contained SVG generated from the same process projection used by the read-only review, rather than from React Flow state or a second semantic model. Keep the output deterministic so exported drawings are stable for reviews and handoffs.

**Why:** The Process Specification is derived presentation data; duplicating relationship semantics in an export path could cause the downloaded drawing to disagree with the on-screen engineering view.

**How to apply:** Extend the projection first when the review gains a new semantic category, then render that projection in the SVG serializer and cover both the projection and Actions-menu download path.