---
name: React Flow selection state
description: Selection feedback loops and remount behavior when React Flow nodes are controlled by workspace state.
---

React Flow's transient visual selection and the workspace's semantic inspector selection must not update each other indefinitely. Controlled node replacement during a surface remount can emit an empty or stale selection event; compare sets before writing parent state and preserve explicit selections across those transitional events. When an event contains both a newly clicked node and a stale edge, prefer the node; an explicit pane click must clear semantic selection and guard its follow-up event.

**Why:** Replacing selected flags in the controlled node list while React Flow is also reconciling its internal selection can cause alternating selection events and React's maximum update depth error.

**How to apply:** When changing graph selection or remount behavior, keep equality-guarded parent setters, initialize nodes from the current semantic selection, treat empty selection events during replacement as transitional unless the user explicitly clicked the canvas, and keep background hit handling separate from node/edge targets.

React Flow's `onSelectionChange` reports its own store, which trails the controlled `nodes` it was handed by one render. Only act on a report that an actual canvas gesture produced — track `select` entries arriving through `onNodesChange` and ignore every other report.

**Why:** Equality guards alone do not stop the loop when the canvas and the workspace hold two *different* non-empty selections: creating a usage selects it, React Flow still reports the previously selected node, echoing that back reselects the old node, and the two alternate until React's maximum update depth error drops the whole workspace into its error boundary — taking palette clicks, drags and connections with it.

**How to apply:** Node clicks, edge clicks and pane clicks already own their selection updates, so `onSelectionChange` is only needed for box and keyboard selection, which always arrive as `select` node changes first. Clear the gesture flag whenever the handler returns early.

React Flow can replace or reposition a controlled node between the first and second pointer events of a double-click, causing the final native event to target the pane instead of the visible node. Name-specific gestures that must survive this should retain the first name hit and validate the second event by timing and proximity.

**Why:** A label-level or `onNodeDoubleClick` handler can miss the same gesture when selection reconciliation moves the node during the click sequence.

**How to apply:** Prefer a cleaned-up native document listener scoped to the editable canvas, with strict target/coordinate checks and teardown; do not broaden the gesture to every node double-click.