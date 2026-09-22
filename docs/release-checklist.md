# First Release Checklist

## Release profile

The first release is a **private, single-instance MVP**:

- JSON files are the persistence boundary for the canonical model and retained checkpoints.
- Collaboration sessions are in-memory, expire after their session lifetime, and are not a durable project store.
- Access is controlled by sharing the collaboration session ID and six-digit code.
- There is no user authentication, tenant isolation, billing, or public multi-tenant access control in this release.
- Desktop Chromium is release-tested with the full graph interaction suite. Firefox runs a portable smoke flow covering the graph, review lenses, Library, selection, dragging, import/export, and collaboration entry. WebKit is explicitly unsupported in the current Replit Nix runtime because its Playwright binary cannot launch with the available Ubuntu ABI libraries. A 900×800 Chromium viewport has a dedicated narrow-layout smoke check; mobile-sized graph editing is not a release promise.

Do not present this release as a public multi-user service until authentication, authorization, durable shared storage, and deployment isolation are added.

## Clean-checkout gate

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pytest -q tests
pnpm --filter @workspace/ppr-modeler run test
```

The browser suite starts disposable API and web services through its Playwright configuration. It should finish with no missing-module errors, runtime error overlay, or unexpected browser console error.

The browser projects are:

```bash
pnpm --filter @workspace/ppr-modeler exec playwright test --project=chromium-desktop
pnpm --filter @workspace/ppr-modeler exec playwright test --project=firefox-desktop
pnpm --filter @workspace/ppr-modeler exec playwright test --project=chromium-narrow
```

The Chromium desktop command runs the full graph, review lenses, Library, selection, dragging, import/export, and collaboration-entry checks. Firefox runs the portable smoke flow for those same categories. The narrow project runs the supported 900×800 smoke flow. WebKit is not a release check until the host ABI dependencies are available; do not substitute mobile-sized viewports or unlisted browser/version combinations for release evidence.

## Production-shaped smoke checks

The artifact configuration publishes the PPR web app at `/` and runs the FastAPI service at `/api`. The API startup health path is `/api/healthz`.

Read-only smoke check against a local or deployed-shaped API:

```bash
RELEASE_BASE_URL=http://127.0.0.1:8080 pnpm run release:smoke
```

The read-only check covers health, MCP initialization at `/api/mcp`, model load,
model validation, all four export formats, and revision availability. Set
`RELEASE_MCP_API_KEY` when the deployed MCP endpoint is bearer-protected. For
disposable or staging data only, run the complete mutation check:

```bash
RELEASE_BASE_URL=http://127.0.0.1:8080 \
RELEASE_SMOKE_ALLOW_MUTATIONS=1 \
pnpm run release:smoke
```

The mutation check additionally covers Save/reload, revision restore, SysML import, and collaboration session create/join/close. Never run it against production data without an explicit recovery plan.

## Manual acceptance pass

- Open the web artifact and confirm the initial model loads through `/api`.
- Load each built-in example and inspect its Product, Process, and Resource review surfaces.
- Create one definition and one usage, attach and clear the definition, then Save.
- Create and edit one relationship; validate the model and inspect the resulting error or success state.
- Export JSON, SysML v2, and AutomationML; import a known-good file and confirm the model refreshes.
- Open History, inspect a prior checkpoint, and restore it.
- Start a collaboration session in one browser and join it from another; make one edit, reconnect once, and confirm both participants converge.
- Export a recovery JSON file before destructive experiments.

## Go/no-go conditions

Do not publish if any of the following is true:

- The clean-checkout gate fails.
- The web artifact cannot load the API through `/api`.
- `/api/healthz` is not healthy after API startup.
- `/api/mcp` cannot initialize or does not advertise tool capabilities.
- Save, validation, import/export, revision restore, or collaboration entry fails in the smoke or manual pass.
- The current Library experience has missing modules, stale test contracts, or runtime errors.
- The launch is being marketed as public multi-user while the private/single-instance boundaries above still apply.

## Recovery

Keep a JSON export before major changes. If the local model becomes unusable, use History to restore a checkpoint or import the saved JSON file. For a deployment rollback, use the previous Replit checkpoint after confirming that the current model export is safe.
