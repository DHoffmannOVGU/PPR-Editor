---
name: Relationship kind contract
description: Boundary between canonical persisted PPR relationships and legacy-compatible relationship inputs.
---

The shared relationship-rules contract describes canonical persisted PPR relationship kinds and must stay aligned with `PprRelationshipKind`. Legacy aliases are accepted only at input/migration boundaries through `RelationshipInputKind`; they must not be added to the canonical rules table.

**Why:** The frontend imports the rules table during module initialization, so mixing the input enum with the persisted enum causes a runtime contract assertion failure before the modeler can render.

**How to apply:** When relationship kinds change, update the OpenAPI schemas/codegen, canonical rules JSON, and backend `RelationKind` together; preserve legacy aliases only in the input union and migration map.