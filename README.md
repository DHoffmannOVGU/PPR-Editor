# PPR Editor

A domain-aware workspace for modeling **Product–Process–Resource** structures and
exporting them toward **SysML v2** and **AutomationML**.

**[Live app →](https://david-hoffmann-ovgu.replit.app)**

Create, connect, move, inspect, validate, save, import, and export Products,
Processes, and Resources. The workspace distinguishes definitions from usages,
supports custom engineering attributes and semantic PPR relationships, does
automatic layout, and ships coherent welding-cell, battery-module, and
pump-assembly examples.

## Stack

- **Frontend** — React, TypeScript, Vite, TanStack Query, React Flow
- **Backend** — Python 3.11, FastAPI, Pydantic v2
- **Persistence** — canonical model JSON
- **API contract** — OpenAPI + Orval codegen
- **Agents** — MCP server bridged to the canonical REST API

Pydantic is the canonical semantic model used by the API, persistence,
validation, and exporters. The generic modeling kernel does not depend on PPR;
PPR specializes it with domain types and relationship constraints. Standards
exports are adapters over that canonical model.

## Getting started

Requires Node.js 24, pnpm 10, Python 3.11, and [uv](https://docs.astral.sh/uv/).

```bash
pnpm install
uv sync
```

Run the API and the web workspace in two terminals:

```bash
PORT=8080 pnpm --filter @workspace/api-server run dev
PORT=23220 API_PORT=8080 pnpm --filter @workspace/ppr-modeler run dev
```

The workspace is then at <http://127.0.0.1:23220>, with the API proxied at
`/api`. `API_PORT` tells the web dev server where the API is.

## Tests

```bash
pnpm run test:ppr     # shared scenarios, backend, frontend, browser suites
pnpm run typecheck    # all packages
pnpm run release:smoke # read-only production-shaped API checks
```

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/ppr-modeler-guide.md`](docs/ppr-modeler-guide.md) | User guide |
| [`docs/agent-integration.md`](docs/agent-integration.md) | MCP client setup, tools, transports |
| [`docs/release-checklist.md`](docs/release-checklist.md) | Release gate, smoke checks, recovery |
| [`replit.md`](replit.md) | Architecture decisions and where things live |

## Where things live

- `backend/model/core.py` — generic modeling kernel
- `backend/model/ppr.py` — PPR specialization, relationship rules, validation
- `backend/main.py` — FastAPI service and JSON persistence
- `backend/mcp_server.py` — agent tools and resources over the REST API
- `backend/sysml.py` — typed SysML v2 projection and emitters
- `backend/exporters.py` — export adapters, including AutomationML
- `lib/api-spec/openapi.yaml` — API contract
- `artifacts/ppr-modeler/` — graphical engineering workspace

## Project status

This is a **private, single-instance MVP**, not a multi-tenant service:

- JSON files are the persistence boundary for the model and its checkpoints.
- Collaboration sessions are in memory and expire; they are not a durable store.
- There is **no authentication, tenant isolation, or authorization**. Access is
  controlled only by sharing a collaboration session ID and six-digit code.
- Desktop Chromium is release-tested; Firefox runs a portable smoke flow.

Do not deploy this as a public multi-user service without adding authentication,
authorization, durable shared storage, and deployment isolation.

## License

[MIT](LICENSE)
