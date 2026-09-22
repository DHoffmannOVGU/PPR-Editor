from __future__ import annotations

import asyncio
import json

import httpx
import httpx2
import pytest
from fastapi.testclient import TestClient
from mcp.client._memory import InMemoryTransport
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import LATEST_PROTOCOL_VERSION

from backend import main as server
from backend import mcp_server


def test_mcp_server_registers_agent_tools_resources_and_prompt() -> None:
    tools = {tool.name: tool for tool in mcp_server.mcp._tool_manager.list_tools()}
    resources = mcp_server.mcp._resource_manager.list_resources()
    prompts = mcp_server.mcp._prompt_manager.list_prompts()

    assert {
        "ppr_get_model",
        "ppr_get_relationship_rules",
        "ppr_update_model_metadata",
        "ppr_create_checkpoint",
        "ppr_validate_model",
        "ppr_create_definition",
        "ppr_create_usage",
        "ppr_create_relationship",
        "ppr_merge_usages",
        "ppr_replace_model",
        "ppr_export_model",
    } <= tools.keys()
    assert tools["ppr_get_model"].annotations.read_only_hint is True
    assert tools["ppr_delete_usage"].annotations.destructive_hint is True
    assert {str(resource.uri) for resource in resources} == {
        "ppr://model/current",
        "ppr://model/revisions",
    }
    assert [prompt.name for prompt in prompts] == ["ppr_modeling_assistant"]


def test_api_client_forwards_agent_context_and_returns_json(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer identity-token"
        assert request.headers["x-collaboration-session"] == "session-1"
        assert request.headers["x-collaboration-token"] == "member-token"
        return httpx.Response(200, json={"id": "model-1"})

    monkeypatch.setenv("PPR_API_BEARER_TOKEN", "identity-token")
    monkeypatch.setenv("PPR_COLLABORATION_SESSION", "session-1")
    monkeypatch.setenv("PPR_COLLABORATION_TOKEN", "member-token")
    client = mcp_server.PprApiClient(
        "http://ppr.test/api", transport=httpx.MockTransport(handler)
    )

    result = asyncio.run(client.request("GET", "/model"))

    assert result == {"id": "model-1"}


def test_api_client_turns_api_validation_response_into_tool_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            422,
            json={
                "detail": {
                    "error": "Relationship is not valid",
                    "issues": [{"message": "Invalid direction"}],
                }
            },
        )

    client = mcp_server.PprApiClient(
        "http://ppr.test/api", transport=httpx.MockTransport(handler)
    )

    with pytest.raises(RuntimeError, match="422: Relationship is not valid") as error:
        asyncio.run(client.request("POST", "/model/relationships", json_body={}))

    assert "Invalid direction" in str(error.value)


def test_create_usage_maps_mcp_arguments_to_rest_payload(monkeypatch) -> None:
    calls: list[tuple[str, str, dict]] = []

    class FakeApi:
        async def request(self, method: str, path: str, **kwargs):
            calls.append((method, path, kwargs))
            return {"id": "resource-1", **kwargs["json_body"]}

    monkeypatch.setattr(mcp_server, "api", FakeApi())

    result = asyncio.run(
        mcp_server.ppr_create_usage(
            "Welder 1", "resource", definition_id="resource-definition"
        )
    )

    assert result["id"] == "resource-1"
    assert calls[0][0:2] == ("POST", "/model/elements")
    assert calls[0][2]["json_body"] == {
        "name": "Welder 1",
        "type": "resource",
        "definition_id": "resource-definition",
        "description": "",
        "x": 100,
        "y": 100,
        "attributes": [],
        "visible_in_ppr": True,
    }


def test_resources_serialize_canonical_api_data(monkeypatch) -> None:
    class FakeApi:
        async def request(self, method: str, path: str, **kwargs):
            return {"id": "model-1", "name": "Cell"}

    monkeypatch.setattr(mcp_server, "api", FakeApi())

    result = asyncio.run(mcp_server.current_model_resource())

    assert json.loads(result) == {"id": "model-1", "name": "Cell"}


def test_mcp_protocol_lists_and_calls_tools(monkeypatch) -> None:
    class FakeApi:
        async def request(self, method: str, path: str, **kwargs):
            return {"status": "ok", "path": path}

    monkeypatch.setattr(mcp_server, "api", FakeApi())

    async def exercise_protocol() -> None:
        async with (
            InMemoryTransport(mcp_server.mcp, raise_exceptions=True) as streams,
            ClientSession(*streams) as session,
        ):
            initialized = await session.initialize()
            tools = await session.list_tools()
            result = await session.call_tool("ppr_health")

            assert initialized.server_info.name == "ppr-engineering-modeler"
            assert "ppr_get_model" in {tool.name for tool in tools.tools}
            assert result.is_error is False
            assert result.structured_content == {
                "status": "ok",
                "path": "/healthz",
            }

    asyncio.run(exercise_protocol())


def test_deployed_fastapi_endpoint_discovers_reads_and_mutates_through_mcp(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")

    async def exercise_deployed_endpoint() -> None:
        async with server.app.router.lifespan_context(server.app):
            transport = httpx2.ASGITransport(app=server.app)
            async with (
                httpx2.AsyncClient(
                    transport=transport, base_url="http://testserver"
                ) as http_client,
                streamable_http_client(
                    "http://testserver/api/mcp", http_client=http_client
                ) as streams,
                ClientSession(*streams) as session,
            ):
                initialized = await session.initialize()
                tools = await session.list_tools()
                health = await session.call_tool("ppr_health")
                model = await session.call_tool("ppr_get_model")
                created = await session.call_tool(
                    "ppr_create_definition",
                    {
                        "name": "MCP-created fixture",
                        "type": "resource",
                        "domain": "Test automation",
                    },
                )
                definition = await session.call_tool(
                    "ppr_get_definition",
                    {"definition_id": created.structured_content["id"]},
                )
                rules = await session.call_tool("ppr_get_relationship_rules")
                checkpoint = await session.call_tool(
                    "ppr_create_checkpoint",
                    {"summary": "MCP integration checkpoint"},
                )
                updated_model = await session.call_tool("ppr_get_model")

                assert initialized.server_info.name == "ppr-engineering-modeler"
                assert len(tools.tools) == 25
                assert health.is_error is False
                assert health.structured_content == {"status": "ok"}
                assert model.is_error is False
                assert isinstance(model.structured_content["id"], str)
                assert created.is_error is False
                created_id = created.structured_content["id"]
                assert definition.structured_content["id"] == created_id
                assert rules.structured_content["becomes"] == [
                    {"source": "product", "target": "product"}
                ]
                assert checkpoint.structured_content["summary"] == (
                    "MCP integration checkpoint"
                )
                assert any(
                    definition["id"] == created_id
                    for definition in updated_model.structured_content["library"][
                        "definitions"
                    ]
                )

    asyncio.run(exercise_deployed_endpoint())


def test_deployed_mcp_endpoint_supports_optional_bearer_auth(
    monkeypatch,
) -> None:
    monkeypatch.setenv("PPR_MCP_API_KEY", "deployment-secret")
    initialize = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": LATEST_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "deployment-probe", "version": "1"},
        },
    }
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }

    with TestClient(server.app) as client:
        unauthorized = client.post("/api/mcp", headers=headers, json=initialize)
        authorized = client.post(
            "/api/mcp/",
            headers={**headers, "Authorization": "Bearer deployment-secret"},
            json=initialize,
        )

    assert unauthorized.status_code == 401
    assert unauthorized.headers["www-authenticate"] == "Bearer"
    assert authorized.status_code == 200
    assert authorized.json()["result"]["serverInfo"]["name"] == (
        "ppr-engineering-modeler"
    )
