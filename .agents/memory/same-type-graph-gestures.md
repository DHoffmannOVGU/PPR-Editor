---
name: Same-type graph gestures
description: Why same-type graph drags are reserved for merge intent and how future relationship creation should coexist with that gesture.
---

Same-type node-to-node drags are reserved for merge intent. Creating a same-type hierarchy or capability relationship should use a separate explicit affordance rather than overloading the merge gesture.

**Why:** A same-type drag is otherwise ambiguous: it can mean “these two usages should become one” or “these two usages should be related.” The merge workflow needs a predictable, atomic interaction, while same-type composition and capability links still need an intentional creation path.

**How to apply:** Preserve the merge behavior in the graph canvas. Add or use a separate inspector or relationship-creation action for valid same-type relationships, with the existing validation, duplicate filtering, and persistence rules.