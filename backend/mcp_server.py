"""MCP bridge for agentic access to the PPR Engineering Modeler API.

The REST API remains the source of truth. This process is deliberately a
client of that API so an MCP server and the web application cannot each keep a
different in-memory copy of the model.
"""

from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

DEFAULT_API_BASE_URL = "http://127.0.0.1:8000/api"


class PprApiClient:
    """Small async client that preserves API errors as useful MCP tool errors."""

    def __init__(
        self,
        base_url: str | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (
            base_url or os.environ.get("PPR_API_BASE_URL", DEFAULT_API_BASE_URL)
        ).rstrip("/")
        self.transport = transport

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Accept": "application/json"}
        bearer_token = os.environ.get("PPR_API_BEARER_TOKEN")
        collaboration_session = os.environ.get("PPR_COLLABORATION_SESSION")
        collaboration_token = os.environ.get("PPR_COLLABORATION_TOKEN")
        collaboration_code = os.environ.get("PPR_COLLABORATION_CODE")
        if bearer_token:
            headers["Authorization"] = f"Bearer {bearer_token}"
        if collaboration_session:
            headers["X-Collaboration-Session"] = collaboration_session
        if collaboration_token:
            headers["X-Collaboration-Token"] = collaboration_token
        elif collaboration_code:
            headers["X-Collaboration-Code"] = collaboration_code
        return headers

    async def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any | None = None,
        content: str | None = None,
        content_type: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        headers = self._headers()
        if content_type:
            headers["Content-Type"] = content_type
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                headers=headers,
                timeout=30.0,
                transport=self.transport,
            ) as client:
                response = await client.request(
                    method,
                    path,
                    json=json_body,
                    content=content,
                    params=params,
                )
        except httpx.RequestError as error:
            raise RuntimeError(
                f"Could not reach the PPR API at {self.base_url}: {error}"
            ) from error

        if response.is_error:
            try:
                payload = response.json()
                detail = payload.get("detail", payload)
            except (ValueError, AttributeError):
                detail = response.text or response.reason_phrase
            if isinstance(detail, dict) and "error" in detail:
                message = detail["error"]
                issues = detail.get("issues")
                if issues:
                    message = f"{message}: {json.dumps(issues, ensure_ascii=False)}"
            elif isinstance(detail, list):
                message = json.dumps(detail, ensure_ascii=False)
            else:
                message = detail
            raise RuntimeError(f"PPR API returned {response.status_code}: {message}")

        if response.status_code == 204:
            return {"ok": True}
        return response.json()


api = PprApiClient()


def configure_in_process_api(app: ASGIApp) -> None:
    """Route mounted MCP tools to the canonical API without another network hop."""

    api.base_url = "http://ppr-modeler.internal/api"
    api.transport = httpx.ASGITransport(app=app)


class MountedMcpApplication:
    """Mount an MCP server into an ASGI app with a lifecycle per event loop.

    A fresh Streamable HTTP session manager is created for each application
    lifespan. This matters for production workers and also keeps repeated or
    concurrent FastAPI TestClient lifespans isolated.
    """

    def __init__(self, server: MCPServer) -> None:
        self.server = server
        self._apps: dict[asyncio.AbstractEventLoop, ASGIApp] = {}

    @asynccontextmanager
    async def lifespan(self) -> AsyncIterator[None]:
        loop = asyncio.get_running_loop()
        http_app = self.server.streamable_http_app(
            streamable_http_path="/",
            stateless_http=True,
            json_response=True,
            host="0.0.0.0",
        )
        self._apps[loop] = http_app
        try:
            async with http_app.router.lifespan_context(http_app):
                yield
        finally:
            self._apps.pop(loop, None)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        api_key = os.environ.get("PPR_MCP_API_KEY")
        if api_key and scope["type"] == "http":
            headers = {
                key.decode("latin-1").lower(): value.decode("latin-1")
                for key, value in scope.get("headers", [])
            }
            supplied = headers.get("authorization", "").removeprefix("Bearer ")
            if not supplied or not hmac.compare_digest(supplied, api_key):
                response = JSONResponse(
                    {"error": "A valid MCP bearer token is required"},
                    status_code=401,
                    headers={"WWW-Authenticate": "Bearer"},
                )
                await response(scope, receive, send)
                return

        app = self._apps.get(asyncio.get_running_loop())
        if app is None:
            response = JSONResponse(
                {"error": "MCP server is not ready"}, status_code=503
            )
            await response(scope, receive, send)
            return
        inner_scope = scope
        if scope["type"] == "http" and scope.get("path") != "/":
            inner_scope = {**scope, "path": "/", "raw_path": b"/"}
        await app(inner_scope, receive, send)


READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
MUTATING = ToolAnnotations(
    readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False
)
DESTRUCTIVE = ToolAnnotations(
    readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=False
)

mcp = MCPServer(
    "ppr-engineering-modeler",
    title="PPR Engineering Modeler",
    description="Inspect and edit Product-Process-Resource engineering models.",
    version="0.1.0",
    instructions=(
        "Inspect the current model before editing it. Prefer small CRUD operations "
        "over replacing the complete model. Use IDs returned by the API, obey PPR "
        "relationship direction and type rules, and validate after a group of edits. "
        "Create an explicit checkpoint after completing a coherent group of edits. "
        "Deletion, reset, import, restore, and whole-model replacement are destructive."
    ),
)
deployed_mcp = MountedMcpApplication(mcp)


@mcp.tool(
    description="Check whether the canonical PPR REST API is reachable.",
    annotations=READ_ONLY,
)
async def ppr_health() -> dict[str, Any]:
    return await api.request("GET", "/healthz")


@mcp.tool(description="Read the complete current PPR model.", annotations=READ_ONLY)
async def ppr_get_model() -> dict[str, Any]:
    return await api.request("GET", "/model")


@mcp.tool(
    description="Read valid source and target types for every PPR relationship kind.",
    annotations=READ_ONLY,
)
async def ppr_get_relationship_rules() -> dict[str, Any]:
    return await api.request("GET", "/model/relationship-rules")


@mcp.tool(
    description="Safely update only the current model name or description.",
    annotations=MUTATING,
)
async def ppr_update_model_metadata(
    name: str | None = None, description: str | None = None
) -> dict[str, Any]:
    changes = {
        key: value
        for key, value in {"name": name, "description": description}.items()
        if value is not None
    }
    if not changes:
        raise ValueError("Provide a model name or description to update.")
    return await api.request("PATCH", "/model", json_body=changes)


@mcp.tool(
    description="List immutable saved model revisions, newest first.",
    annotations=READ_ONLY,
)
async def ppr_list_revisions() -> list[dict[str, Any]]:
    return await api.request("GET", "/model/revisions")


@mcp.tool(
    description="Read one saved revision, including its model.", annotations=READ_ONLY
)
async def ppr_get_revision(revision_id: str) -> dict[str, Any]:
    return await api.request("GET", f"/model/revisions/{revision_id}")


@mcp.tool(
    description="Save a recoverable revision after a coherent group of incremental edits.",
    annotations=MUTATING,
)
async def ppr_create_checkpoint(
    summary: str = "Agent checkpoint",
) -> dict[str, Any]:
    return await api.request("POST", "/model/revisions", json_body={"summary": summary})


@mcp.tool(
    description="Validate a proposed PPR model without saving or changing it.",
    annotations=READ_ONLY,
)
async def ppr_validate_model(model: dict[str, Any]) -> dict[str, Any]:
    return await api.request("POST", "/model/validate", json_body=model)


@mcp.tool(
    description=(
        "Create a reusable product, process, or resource definition. "
        "Attributes are objects with name, value, and optional unit fields."
    ),
    annotations=MUTATING,
)
async def ppr_create_definition(
    name: str,
    type: Literal["product", "process", "resource"],
    description: str = "",
    domain: str | None = None,
    parent_definition_id: str | None = None,
    attributes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return await api.request(
        "POST",
        "/model/definitions",
        json_body={
            "name": name,
            "type": type,
            "description": description,
            "domain": domain,
            "parent_definition_id": parent_definition_id,
            "attributes": attributes or [],
        },
    )


@mcp.tool(
    description="Read one reusable library definition by ID.", annotations=READ_ONLY
)
async def ppr_get_definition(definition_id: str) -> dict[str, Any]:
    return await api.request("GET", f"/model/definitions/{definition_id}")


@mcp.tool(
    description=(
        "Update a definition. Put only changed fields in changes: name, description, "
        "domain, parent_definition_id, or attributes. Use null to clear an optional field."
    ),
    annotations=MUTATING,
)
async def ppr_update_definition(
    definition_id: str, changes: dict[str, Any]
) -> dict[str, Any]:
    return await api.request(
        "PATCH", f"/model/definitions/{definition_id}", json_body=changes
    )


@mcp.tool(
    description=(
        "Delete an unused definition. This fails while usages or child definitions depend on it."
    ),
    annotations=DESTRUCTIVE,
)
async def ppr_delete_definition(definition_id: str) -> dict[str, Any]:
    return await api.request("DELETE", f"/model/definitions/{definition_id}")


@mcp.tool(
    description=(
        "Create a diagram usage of a product, process, or resource. definition_id is "
        "optional but, when supplied, must reference a definition of the same type."
    ),
    annotations=MUTATING,
)
async def ppr_create_usage(
    name: str,
    type: Literal["product", "process", "resource"],
    definition_id: str | None = None,
    description: str = "",
    x: float = 100,
    y: float = 100,
    attributes: list[dict[str, Any]] | None = None,
    visible_in_ppr: bool = True,
) -> dict[str, Any]:
    return await api.request(
        "POST",
        "/model/elements",
        json_body={
            "name": name,
            "type": type,
            "definition_id": definition_id,
            "description": description,
            "x": x,
            "y": y,
            "attributes": attributes or [],
            "visible_in_ppr": visible_in_ppr,
        },
    )


@mcp.tool(description="Read one diagram usage by ID.", annotations=READ_ONLY)
async def ppr_get_usage(usage_id: str) -> dict[str, Any]:
    return await api.request("GET", f"/model/elements/{usage_id}")


@mcp.tool(
    description=(
        "Update a diagram usage. Put only changed fields in changes: name, definition_id, "
        "description, x, y, attributes, or visible_in_ppr. Use null to detach a definition."
    ),
    annotations=MUTATING,
)
async def ppr_update_usage(usage_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    return await api.request("PATCH", f"/model/elements/{usage_id}", json_body=changes)


@mcp.tool(
    description="Delete a usage and every relationship connected to it.",
    annotations=DESTRUCTIVE,
)
async def ppr_delete_usage(usage_id: str) -> dict[str, Any]:
    return await api.request("DELETE", f"/model/elements/{usage_id}")


@mcp.tool(
    description=(
        "Create a directed semantic relationship between usages. Kinds are input_to, "
        "produces, performs, supports, succeeds, transfers, flows_to, contains, and "
        "composed_of. The API enforces valid source/target type combinations."
    ),
    annotations=MUTATING,
)
async def ppr_create_relationship(
    source_id: str,
    target_id: str,
    kind: Literal[
        "input_to",
        "produces",
        "performs",
        "supports",
        "succeeds",
        "transfers",
        "flows_to",
        "contains",
        "composed_of",
    ],
    role_name: str | None = None,
    quantity: float | None = None,
    unit: str | None = None,
    lower_bound: int | None = None,
    upper_bound: int | Literal["*"] | None = None,
) -> dict[str, Any]:
    return await api.request(
        "POST",
        "/model/relationships",
        json_body={
            "source_id": source_id,
            "target_id": target_id,
            "kind": kind,
            "role_name": role_name,
            "quantity": quantity,
            "unit": unit,
            "lower_bound": lower_bound,
            "upper_bound": upper_bound,
        },
    )


@mcp.tool(description="Read one semantic relationship by ID.", annotations=READ_ONLY)
async def ppr_get_relationship(relationship_id: str) -> dict[str, Any]:
    return await api.request("GET", f"/model/relationships/{relationship_id}")


@mcp.tool(
    description=(
        "Update relationship metadata. Put only changed fields in changes: role_name, "
        "quantity, unit, lower_bound, or upper_bound."
    ),
    annotations=MUTATING,
)
async def ppr_update_relationship(
    relationship_id: str, changes: dict[str, Any]
) -> dict[str, Any]:
    return await api.request(
        "PATCH", f"/model/relationships/{relationship_id}", json_body=changes
    )


@mcp.tool(description="Delete a semantic relationship.", annotations=DESTRUCTIVE)
async def ppr_delete_relationship(relationship_id: str) -> dict[str, Any]:
    return await api.request("DELETE", f"/model/relationships/{relationship_id}")


@mcp.tool(
    description=(
        "Atomically merge two same-type usages. The survivor must be one of the two IDs. "
        "Choose first or second for name and description, first/second/none for the "
        "definition, resolve conflicting attributes explicitly, and reject or drop "
        "relationships that would become self-loops."
    ),
    annotations=DESTRUCTIVE,
)
async def ppr_merge_usages(
    first_id: str,
    second_id: str,
    survivor_id: str,
    name_source: Literal["first", "second"],
    description_source: Literal["first", "second"],
    definition_source: Literal["first", "second", "none"],
    self_loop_policy: Literal["reject", "drop"],
    attribute_decisions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return await api.request(
        "POST",
        "/model/merge",
        json_body={
            "first_id": first_id,
            "second_id": second_id,
            "survivor_id": survivor_id,
            "name_source": name_source,
            "description_source": description_source,
            "definition_source": definition_source,
            "self_loop_policy": self_loop_policy,
            "attribute_decisions": attribute_decisions or [],
        },
    )


@mcp.tool(
    description=(
        "Atomically replace and persist a complete model document containing id, name, "
        "description, library, and diagram. Prefer focused CRUD or metadata tools. "
        "Set checkpoint to create a revision when the model differs from the last snapshot."
    ),
    annotations=DESTRUCTIVE,
)
async def ppr_replace_model(
    model: dict[str, Any], checkpoint: bool = True
) -> dict[str, Any]:
    return await api.request(
        "PUT", "/model", json_body=model, params={"checkpoint": checkpoint}
    )


@mcp.tool(
    description="Restore a saved revision as the current model and create a new revision.",
    annotations=DESTRUCTIVE,
)
async def ppr_restore_revision(revision_id: str) -> dict[str, Any]:
    return await api.request("POST", f"/model/revisions/{revision_id}/restore")


@mcp.tool(
    description="Export the current model as JSON, portable SysML, PPR-profiled SysML, or AutomationML.",
    annotations=READ_ONLY,
)
async def ppr_export_model(
    format: Literal["json", "sysml", "sysml-ppr", "automationml"],
) -> dict[str, Any]:
    return await api.request("GET", f"/model/export/{format}")


@mcp.tool(
    description="Import SysML or AutomationML and replace the current model.",
    annotations=DESTRUCTIVE,
)
async def ppr_import_model(
    format: Literal["sysml", "automationml"], content: str
) -> dict[str, Any]:
    content_type = "text/plain" if format == "sysml" else "application/xml"
    return await api.request(
        "POST",
        f"/model/import/{format}",
        content=content,
        content_type=content_type,
    )


@mcp.resource(
    "ppr://model/current",
    name="Current PPR model",
    description="The canonical current engineering model as JSON.",
    mime_type="application/json",
)
async def current_model_resource() -> str:
    return json.dumps(await api.request("GET", "/model"), indent=2)


@mcp.resource(
    "ppr://model/revisions",
    name="PPR model revisions",
    description="Saved model revision summaries as JSON.",
    mime_type="application/json",
)
async def revisions_resource() -> str:
    return json.dumps(await api.request("GET", "/model/revisions"), indent=2)


@mcp.prompt(
    name="ppr_modeling_assistant",
    description="Start a careful agentic PPR modeling workflow.",
)
def ppr_modeling_assistant(task: str) -> str:
    return (
        f"Work on this PPR engineering-modeling task: {task}\n\n"
        "First read ppr://model/current. Reuse suitable definitions, create definitions "
        "before usages, and use returned IDs for relationships. Make focused changes, "
        "then call ppr_get_model and ppr_validate_model on the result. Explain validation "
        "issues, then create a checkpoint with a concise summary. Do not delete, import, "
        "restore, or replace the model unless the user explicitly requested that "
        "destructive action."
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the PPR Modeler MCP server")
    parser.add_argument(
        "--transport",
        choices=("stdio", "streamable-http"),
        default=os.environ.get("PPR_MCP_TRANSPORT", "stdio"),
    )
    parser.add_argument("--host", default=os.environ.get("PPR_MCP_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("PPR_MCP_PORT", "8001"))
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.transport == "stdio":
        mcp.run(transport="stdio")
    else:
        mcp.run(
            transport="streamable-http",
            host=args.host,
            port=args.port,
            streamable_http_path="/mcp",
            stateless_http=True,
            json_response=True,
        )


if __name__ == "__main__":
    main()
