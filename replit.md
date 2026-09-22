# PPR Engineering Modeler

A lightweight, domain-aware workspace for modeling Product–Process–Resource structures and exporting them toward SysML v2 and AutomationML.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the FastAPI semantic backend
- `pnpm --filter @workspace/ppr-modeler run dev` — run the React modeling workspace
- `uv run python -m backend.mcp_server` — run the PPR agent MCP server over stdio
- `uv run python -m backend.mcp_server --transport streamable-http` — expose MCP at `http://127.0.0.1:8001/mcp`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run test:ppr` — run the shared PPR scenario, backend, frontend, and browser regression suites
- `pnpm run release:smoke` — run read-only production-shaped API smoke checks; set `RELEASE_SMOKE_ALLOW_MUTATIONS=1` only for disposable or staging data
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `uv run python -m compileall -q backend` — check the Python backend

## Stack

- Frontend: React, TypeScript, Vite, TanStack Query
- Backend: Python 3.11, FastAPI, Pydantic v2
- Persistence: canonical model JSON
- API contract and client codegen: OpenAPI + Orval

## Where things live

- `backend/model/core.py` — generic modeling kernel
- `backend/model/ppr.py` — PPR specialization, relationship rules, validation, example
- `backend/main.py` — FastAPI service and JSON persistence
- `backend/mcp_server.py` — agent tools/resources bridged to the canonical REST API
- `backend/sysml.py` — typed SysML v2 projection plus PPR-profiled and portable emitters
- `backend/exporters.py` — public export adapters, including the AutomationML adapter
- `lib/api-spec/openapi.yaml` — API contract
- `artifacts/ppr-modeler/` — graphical engineering workspace

## Architecture decisions

- Pydantic is the canonical semantic model used by API, persistence, validation, and exporters.
- Graph coordinates live on semantic elements so the visual workspace does not maintain a separate graph model.
- The generic kernel does not depend on PPR; PPR specializes it with domain types and relationship constraints.
- JSON is the MVP persistence format; standards exports are adapters over the canonical model.

## First release boundary

- The first release is private and single-instance, with JSON-file model persistence.
- Collaboration sessions are in memory and expire; they are not a durable project store.
- The release is desktop-first and Chromium-tested.
- Authentication, tenant isolation, durable multi-instance storage, billing, and public multi-user operation are out of scope for this release.

See `docs/ppr-modeler-guide.md` for the user guide and `docs/release-checklist.md` for the release gate, smoke checks, and recovery procedure.
See `docs/agent-integration.md` for MCP client setup, tools, transports, and collaboration credentials.

## Product

Create, connect, move, inspect, validate, save, import, and export Products, Processes, and Resources. The workspace distinguishes definitions from usages, supports custom engineering attributes, semantic PPR relationships, automatic layout, and coherent welding-cell, battery-module, and pump-assembly examples.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run OpenAPI codegen after changing `lib/api-spec/openapi.yaml`.
- The managed API workflow runs the Python service even though its workspace package is named `api-server`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
