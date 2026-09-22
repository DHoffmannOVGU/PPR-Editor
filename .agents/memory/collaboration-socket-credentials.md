---
name: Collaboration socket credentials
description: Browser-safe transport for scoped collaboration membership credentials
---

Browser WebSockets should have a session-scoped, HttpOnly membership cookie as a transport fallback when a development or deployment proxy strips `Sec-WebSocket-Protocol`. Keep the membership token header/subprotocol path for non-browser clients, and never put the six-digit join code in a normal invitation URL.

**Why:** The proxied browser WebSocket path accepted the same authenticated REST requests but dropped the membership subprotocol, which caused valid collaborators to receive 403 responses until the browser also sent a scoped cookie.

**How to apply:** When changing collaboration socket authentication or proxy routing, verify both browser cookies and explicit API-client credentials, and keep cookie names bound to the collaboration session so one session’s token cannot authorize another.