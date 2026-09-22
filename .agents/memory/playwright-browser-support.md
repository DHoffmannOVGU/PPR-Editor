---
name: Playwright browser support
description: Browser and viewport limits for the PPR modeler release checks.
---

The PPR modeler’s repeatable browser contract is exhaustive Chromium desktop coverage, portable smoke coverage in Firefox desktop, and a 900×800 Chromium narrow-layout smoke. WebKit is not release-qualified in the current Replit Nix runtime because its Playwright build requires Ubuntu ABI libraries that are unavailable there.

**Why:** Playwright browser binaries are not sufficient on their own; WebKit launch validation fails before any app code runs when the host ABI is missing.

**How to apply:** Keep WebKit opt-in until the runtime can launch it, and distinguish portable smoke coverage from Chromium-only timing- and gesture-sensitive tests when documenting support.