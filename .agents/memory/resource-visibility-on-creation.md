---
name: Resource visibility on creation
description: The graph intentionally filters unassigned resource usages until they are selected or connected.
---

The main React Flow canvas renders every diagram resource directly; resource-tree filtering belongs only to the separate Resource review surface.

**Why:** Hiding unassigned resources in the graph made direct resource creation look broken and prevented engineers from seeing the resource they had just added.

**How to apply:** Keep the canvas projection unfiltered for resources. Preserve any tree-specific expansion or visibility rules inside the Resource review only.