---
name: Center alignment guides
description: The graph’s temporary alignment behavior for interactive node dragging.
---

Graph alignment is intentionally center-only: nearby visible node centers produce a stronger accent-colored guide, and the dragged node snaps to that center while the pointer remains within a small tolerance. Keep the last snapped position authoritative through React Flow's final drag-position event.

**Why:** Center alignment is the useful engineering-layout cue without cluttering the canvas with six simultaneous edge guides, and snapping makes the cue actionable. React Flow can report a final pointer position slightly after the visual snap, so accepting that raw value creates a release jump.

**How to apply:** Keep guides and live snapping transient to the React Flow interaction layer. Never persist or broadcast guide state; only the existing drag-stop position update belongs in the semantic model path, using the last snapped position rather than the terminal pointer coordinate.

The snap tolerance is defined in screen pixels and converted to flow coordinates from the current viewport zoom. Guide strokes use the inverse zoom so their visible width stays consistent.

**Why:** A fixed flow-space tolerance becomes unusably narrow when zoomed out and too loose when zoomed in, while viewport-transformed CSS strokes otherwise change apparent weight.

**How to apply:** Recompute the tolerance and guide stroke width from the live zoom for every drag render; cancellation, blur, and lost pointer capture must clear both the visible guide and its transient snapped position.

In forced-colors mode, guides must opt out of palette remapping, use a system contrast color, and use a dashed stroke so they remain visible against the canvas and solid node borders.

**Why:** Browser high-contrast palettes can replace the accent color with a low-salience value, making the temporary alignment cue disappear even though the drag geometry is correct.

**How to apply:** Keep the forced-colors rule scoped to the transient guide class and retain all guide state in the React Flow interaction layer; never put accessibility presentation into saved element positions.