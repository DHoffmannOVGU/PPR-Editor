---
name: Collaboration reconnect queue
description: Protocol decision for protecting local model edits across temporary collaboration socket loss.
---

The collaboration client must retain one in-flight snapshot and replace any additional local edits with a single latest pending snapshot. Each sent snapshot carries a client update ID, and the session keeps a bounded idempotency ledger so a lost acknowledgment can be retried without creating another revision.

**Why:** A reconnect can race with an accepted update whose acknowledgment was lost, while newer local edits may already exist. Resending every intermediate snapshot creates conflicts and treating any acknowledgment as final can discard the newest edit.

**How to apply:** Advance a pending snapshot's base revision only after the matching in-flight update is acknowledged. On conflict, keep the local snapshot visible and require an explicit keep-local or use-server choice rather than overwriting the editor state.