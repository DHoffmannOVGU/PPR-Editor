---
name: GitHub publishing path
description: How to publish this workspace when GitHub OAuth is connected
---

The connected GitHub OAuth account authorizes API operations, but it does not automatically provide credentials to the workspace's local HTTPS Git remote. Publishing a complete snapshot can use the Git Data API: upload blobs, create a tree from the current tracked files, create a commit with the remote branch as parent, and update the branch without force-push.

**Why:** A direct `git push` can fail with GitHub's “Password authentication is not supported” even though the Replit GitHub integration has repository push permission.

**How to apply:** Verify the destination ref first, preserve it as the commit parent, publish the current tracked tree through the connector proxy, and confirm the updated ref and tree before reporting success.