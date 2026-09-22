---
name: Standalone PPR export lowering
description: How standards exports should represent diagram usages without Library definitions.
---

Standalone diagram usages are valid PPR concepts, but SysML and similar standards require a definition symbol for each usage. Lower an unassigned usage to a deterministic implicit definition derived from its stable usage ID; do not index a nullable reference or silently drop the usage.

**Why:** A nullable PPR definition reference is intentional for quick, diagram-local modeling, while standards formats still require a type/definition target for generated usage syntax and relationship ports.

**How to apply:** Keep the implicit definition export-only and deterministic. Preserve the canonical usage as a normal `usage` with `definition_id: null`, and continue using real Library definitions whenever a usage has a reference.