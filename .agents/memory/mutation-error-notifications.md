---
name: Mutation error notifications
description: React Query mutation ownership and error notification behavior for transient graph UI.
---

Mutation callbacks that are supplied to a per-call `mutate` invocation may not run after the component owning the mutation hook unmounts. Mutations started by a dialog that closes immediately must therefore be owned by a persistent parent surface.

**Why:** A relationship creation dialog closed as soon as it submitted, so its hook unmounted before a failed request resolved and the error notification was lost.

**How to apply:** Keep persistence hooks in the workspace layout or another long-lived component, pass mutation actions into transient dialogs, and leave the parent mounted until success or failure handling completes.