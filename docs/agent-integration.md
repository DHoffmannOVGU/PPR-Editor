# Agent and MCP integration

The PPR Modeler exposes the canonical model through its existing REST API and
through a Model Context Protocol (MCP) bridge. The MCP server calls the REST
API rather than loading the JSON data file itself, so the browser and agents
always use the same validation, persistence, revision, and collaboration
rules.

The deployed FastAPI application serves Streamable HTTP MCP at
`https://<your-app-host>/api/mcp` (with or without a trailing slash). No second
process or port is needed in a deployment.

## Start the services

Start the application API first:

```bash
PORT=8000 uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

For a local MCP client that launches servers over stdio, configure:

```json
{
  "mcpServers": {
    "ppr-modeler": {
      "command": "uv",
      "args": ["run", "python", "-m", "backend.mcp_server"],
      "env": {
        "PPR_API_BASE_URL": "http://127.0.0.1:8000/api"
      }
    }
  }
}
```

Run a hosted Streamable HTTP MCP endpoint at `http://127.0.0.1:8001/mcp`
with:

```bash
PPR_API_BASE_URL=http://127.0.0.1:8000/api \
  uv run python -m backend.mcp_server --transport streamable-http --port 8001
```

The HTTP transport binds to loopback by default. Add an authenticated reverse
proxy before exposing it on a network.

For the deployed endpoint, set `PPR_MCP_API_KEY` in the deployment environment
and configure the MCP client to send `Authorization: Bearer <value>`. The
endpoint remains available without a token when this variable is unset, which
is intended only for a private development deployment.

## Available agent capabilities

The server offers 25 tools for reading and validating the model; discovering
relationship rules; creating, reading, updating, and deleting definitions,
usages, and relationships; safely updating model metadata; creating,
inspecting, and restoring checkpoints; whole-model replacement; standards
import; and JSON, SysML, or AutomationML export. Read-only and destructive
hints are included in the MCP schemas. REST validation details are preserved in
tool errors so agents receive the same semantic feedback as direct API clients.
It also publishes the current model and revision list as MCP resources and
includes a modeling-workflow prompt.

The REST contract is documented at `/docs` on a running API and in
`lib/api-spec/openapi.yaml`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PPR_API_BASE_URL` | `http://127.0.0.1:8000/api` | Canonical REST API used by MCP |
| `PPR_MCP_API_KEY` | unset | Optional bearer token protecting the deployed `/api/mcp` endpoint |
| `PPR_API_BEARER_TOKEN` | unset | Signed API identity token for collaboration |
| `PPR_COLLABORATION_SESSION` | unset | Target collaboration session |
| `PPR_COLLABORATION_TOKEN` | unset | Session membership token |
| `PPR_COLLABORATION_CODE` | unset | Owner-only fallback when no membership token is set |
| `PPR_MCP_TRANSPORT` | `stdio` | `stdio` or `streamable-http` |
| `PPR_MCP_HOST` | `127.0.0.1` | HTTP bind host |
| `PPR_MCP_PORT` | `8001` | HTTP bind port |

For a collaboration session, set the bearer identity token, session ID, and
membership token together. The API will enforce viewer/editor/owner rights for
every MCP call.
