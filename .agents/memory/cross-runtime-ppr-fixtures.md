---
name: Cross-runtime PPR fixtures
description: How the shared scenario registry is consumed by Vite, Python, and Playwright.
---

Keep the scenario registry in one JSON source that can be parsed by each runtime. Vite can bundle it as a JSON module, Python can load it with `json`, and Playwright’s Node ESM runner should read the same file from disk rather than importing it directly.

**Why:** The app bundler accepts JSON imports, while the Playwright test runner may reject a direct JSON module import without an import attribute before any browser test is discovered.

**How to apply:** When adding scenarios, update the shared JSON first and keep runtime-specific adapters thin; do not duplicate model data in browser or backend test files.