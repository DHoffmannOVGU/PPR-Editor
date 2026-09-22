from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from backend import main as server
from backend.model.ppr import PprModel


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "identity-model.json")
    server.current_model = PprModel()
    server.revision_history_cache_path = None
    server.revision_history = []
    return TestClient(server.app)


def _build_transition(client: TestClient) -> tuple[dict, dict, dict]:
    definition = client.post(
        "/api/model/definitions",
        json={"name": "Housing", "type": "product", "states": ["raw", "machined"]},
    ).json()
    raw = client.post(
        "/api/model/elements",
        json={
            "name": "Casting at Infeed",
            "type": "product",
            "definition_id": definition["id"],
            "state": "raw",
        },
    ).json()
    machined = client.post(
        "/api/model/elements",
        json={
            "name": "Housing after Mill",
            "type": "product",
            "definition_id": definition["id"],
            "state": "machined",
        },
    ).json()
    process = client.post(
        "/api/model/elements", json={"name": "Mill", "type": "process"}
    ).json()
    client.post(
        "/api/model/relationships",
        json={"source_id": raw["id"], "target_id": process["id"], "kind": "consumed_by"},
    )
    client.post(
        "/api/model/relationships",
        json={"source_id": process["id"], "target_id": machined["id"], "kind": "produces"},
    )
    return raw, machined, process


def test_items_partition_and_identity_validation(client: TestClient) -> None:
    raw, machined, process = _build_transition(client)
    linked = client.post(
        "/api/model/relationships",
        json={"source_id": raw["id"], "target_id": machined["id"], "kind": "becomes"},
    )

    assert linked.status_code == 201
    assert linked.json()["kind"] == "becomes"
    items = client.get("/api/model/items").json()
    assert items == [
        {
            "id": f"item_{raw['id'].split('_', 1)[1]}",
            "name": "Casting at Infeed",
            "definition_ids": [raw["definition_id"]],
            "chain": [
                {
                    "element_id": raw["id"],
                    "state": "raw",
                    "produced_by": None,
                    "consumed_by": process["id"],
                },
                {
                    "element_id": machined["id"],
                    "state": "machined",
                    "produced_by": process["id"],
                    "consumed_by": None,
                },
            ],
            "absorbed_into": None,
        }
    ]
    issues = client.post("/api/model/validate", json=client.get("/api/model").json()).json()["issues"]
    assert not any(issue["code"] == "IDENT-5" for issue in issues)


def test_becomes_is_linear_acyclic_and_has_no_qualifiers(client: TestClient) -> None:
    raw, machined, _ = _build_transition(client)
    third = client.post(
        "/api/model/elements", json={"name": "Released", "type": "product"}
    ).json()
    assert client.post(
        "/api/model/relationships",
        json={"source_id": raw["id"], "target_id": machined["id"], "kind": "becomes"},
    ).status_code == 201

    branch = client.post(
        "/api/model/relationships",
        json={"source_id": raw["id"], "target_id": third["id"], "kind": "becomes"},
    )
    cycle = client.post(
        "/api/model/relationships",
        json={"source_id": machined["id"], "target_id": raw["id"], "kind": "becomes"},
    )
    qualifier = client.post(
        "/api/model/relationships",
        json={
            "source_id": machined["id"],
            "target_id": third["id"],
            "kind": "becomes",
            "quantity": 1,
        },
    )

    assert branch.status_code == 422
    assert any(issue["code"] == "IDENT-2" for issue in branch.json()["detail"]["issues"])
    assert cycle.status_code == 422
    assert any(issue["code"] == "IDENT-3" for issue in cycle.json()["detail"]["issues"])
    assert qualifier.status_code == 422
    assert any(issue["code"] == "IDENT-4" for issue in qualifier.json()["detail"]["issues"])


def test_aliases_are_canonical_on_write_and_reads(client: TestClient) -> None:
    product = client.post(
        "/api/model/elements", json={"name": "Input", "type": "product"}
    ).json()
    process = client.post(
        "/api/model/elements", json={"name": "Work", "type": "process"}
    ).json()

    response = client.post(
        "/api/model/relationships",
        json={"source_id": product["id"], "target_id": process["id"], "kind": "input_to"},
    )

    assert response.status_code == 201
    assert response.json()["kind"] == "consumed_by"
    assert "consumed_by" in response.headers["Deprecation"]
    assert client.get("/api/model").json()["diagram"]["relationships"][0]["kind"] == "consumed_by"


def test_identity_inference_is_dry_run_until_explicitly_applied(client: TestClient) -> None:
    raw, machined, _ = _build_transition(client)

    dry_run = client.post("/api/model/items/infer").json()
    assert dry_run["proposals"] == [
        {
            "source_id": raw["id"],
            "target_id": machined["id"],
            "confidence": "high",
            "reason": "Mill has exactly one non-byproduct input and output",
        }
    ]
    assert all(
        relationship["kind"] != "becomes"
        for relationship in client.get("/api/model").json()["diagram"]["relationships"]
    )

    applied = client.post("/api/model/items/infer", json={"apply": True})
    assert applied.status_code == 200
    assert any(
        relationship["kind"] == "becomes"
        for relationship in client.get("/api/model").json()["diagram"]["relationships"]
    )
