from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main as server
from backend.exporters import export_automationml
from backend.model import ppr as ppr_model
from backend.model.ppr import example_model
from backend.model.scenarios import get_ppr_scenarios


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    return TestClient(server.app)


def test_health_and_get_model(client: TestClient) -> None:
    health = client.get("/api/healthz")
    response = client.get("/api/model")

    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert response.status_code == 200
    assert len(response.json()["library"]["definitions"]) == 7
    assert len(response.json()["diagram"]["usages"]) == 7
    assert len(response.json()["diagram"]["relationships"]) == 7


def test_usage_ppr_visibility_defaults_and_updates(client: TestClient) -> None:
    assert client.post("/api/model/reset").status_code == 200

    default_usage = client.post(
        "/api/model/elements",
        json={"name": "Main operation", "type": "process"},
    )
    view_only_usage = client.post(
        "/api/model/elements",
        json={
            "name": "Supporting operation",
            "type": "process",
            "visible_in_ppr": False,
        },
    )

    assert default_usage.status_code == 201
    assert default_usage.json()["visible_in_ppr"] is True
    assert view_only_usage.status_code == 201
    assert view_only_usage.json()["visible_in_ppr"] is False

    promoted = client.patch(
        f"/api/model/elements/{view_only_usage.json()['id']}",
        json={"visible_in_ppr": True},
    )
    assert promoted.status_code == 200
    assert promoted.json()["visible_in_ppr"] is True


def test_usage_and_definition_attributes_can_be_replaced_via_patch(
    client: TestClient,
) -> None:
    usage = client.post(
        "/api/model/elements",
        json={"name": "Machine", "type": "resource"},
    )
    definition = client.post(
        "/api/model/definitions",
        json={"name": "Machine type", "type": "resource"},
    )

    usage_update = client.patch(
        f"/api/model/elements/{usage.json()['id']}",
        json={"attributes": [{"name": "shift", "value": "3", "datatype": "integer"}]},
    )
    definition_update = client.patch(
        f"/api/model/definitions/{definition.json()['id']}",
        json={"attributes": [{"name": "axis count", "value": 5}]},
    )

    assert usage_update.status_code == 200
    assert usage_update.json()["attributes"][0]["name"] == "shift"
    assert usage_update.json()["attributes"][0]["value"] == "3"
    assert usage_update.json()["attributes"][0]["datatype"] == "integer"
    assert usage_update.json()["attributes"][0]["id"].startswith("attr_")
    assert definition_update.status_code == 200
    assert definition_update.json()["attributes"][0]["value"] == 5
    assert client.get(f"/api/model/elements/{usage.json()['id']}").json() == (
        usage_update.json()
    )
    assert (
        client.get(f"/api/model/definitions/{definition.json()['id']}").json()
        == definition_update.json()
    )


def test_partial_model_replace_is_rejected_and_metadata_has_a_safe_patch(
    client: TestClient,
) -> None:
    before = client.get("/api/model").json()

    rejected = client.put("/api/model", json={"name": "Accidental replacement"})
    renamed = client.patch(
        "/api/model",
        json={"name": "Safely renamed", "description": "Metadata-only update"},
    )

    assert rejected.status_code == 422
    assert rejected.json()["detail"]["error"] == (
        "PUT /api/model requires a complete model document."
    )
    assert client.get("/api/model").json()["id"] == before["id"]
    assert renamed.status_code == 200
    assert renamed.json()["id"] == before["id"]
    assert renamed.json()["name"] == "Safely renamed"
    assert len(renamed.json()["diagram"]["usages"]) == len(before["diagram"]["usages"])


def test_unknown_mutation_fields_are_rejected_instead_of_ignored(
    client: TestClient,
) -> None:
    definition = client.post(
        "/api/model/definitions",
        json={"name": "Positioned definition", "type": "resource", "x": 200},
    )
    usage = client.post(
        "/api/model/elements",
        json={"name": "Typed usage", "type": "resource"},
    )
    changed_type = client.patch(
        f"/api/model/elements/{usage.json()['id']}",
        json={"type": "product"},
    )

    assert definition.status_code == 422
    assert changed_type.status_code == 422
    assert any(
        issue["type"] == "extra_forbidden" for issue in definition.json()["detail"]
    )
    assert any(
        issue["type"] == "extra_forbidden" for issue in changed_type.json()["detail"]
    )


def test_element_relationship_and_definition_usage_workflow(client: TestClient) -> None:
    assert client.post("/api/model/reset").status_code == 200

    product = client.post(
        "/api/model/definitions",
        json={"name": "Sheet Metal", "type": "product"},
    )
    process = client.post(
        "/api/model/definitions",
        json={"name": "Spot Welding", "type": "process"},
    )
    resource = client.post(
        "/api/model/definitions",
        json={"name": "Welding Robot", "type": "resource"},
    )

    assert product.status_code == 201
    assert process.status_code == 201
    assert resource.status_code == 201

    usage = client.post(
        "/api/model/elements",
        json={
            "name": "robot1",
            "type": "resource",
            "definition_id": resource.json()["id"],
        },
    )
    invalid_usage = client.post(
        "/api/model/elements",
        json={"name": "robot2", "type": "resource"},
    )
    assert usage.status_code == 201
    assert invalid_usage.status_code == 201
    assert invalid_usage.json()["definition_id"] is None

    attached = client.patch(
        f"/api/model/elements/{invalid_usage.json()['id']}",
        json={"definition_id": resource.json()["id"]},
    )
    cleared = client.patch(
        f"/api/model/elements/{invalid_usage.json()['id']}",
        json={"definition_id": None},
    )
    incompatible = client.patch(
        f"/api/model/elements/{invalid_usage.json()['id']}",
        json={"definition_id": product.json()["id"]},
    )
    assert attached.status_code == 200
    assert attached.json()["definition_id"] == resource.json()["id"]
    assert cleared.status_code == 200
    assert cleared.json()["definition_id"] is None
    assert incompatible.status_code == 422

    persisted = client.put("/api/model", json=client.get("/api/model").json())
    persisted_usage = next(
        item
        for item in persisted.json()["diagram"]["usages"]
        if item["id"] == invalid_usage.json()["id"]
    )
    assert persisted.status_code == 200
    assert persisted_usage["definition_id"] is None

    product_usage = client.post(
        "/api/model/elements",
        json={
            "name": "sheet1",
            "type": "product",
            "definition_id": product.json()["id"],
        },
    )
    process_usage = client.post(
        "/api/model/elements",
        json={
            "name": "weld1",
            "type": "process",
            "definition_id": process.json()["id"],
        },
    )
    relation = client.post(
        "/api/model/relationships",
        json={
            "source_id": product_usage.json()["id"],
            "target_id": process_usage.json()["id"],
            "kind": "input_to",
            "role_name": "sheetMaterial",
            "lower_bound": 1,
            "upper_bound": "*",
        },
    )
    invalid_relation = client.post(
        "/api/model/relationships",
        json={
            "source_id": usage.json()["id"],
            "target_id": product_usage.json()["id"],
            "kind": "performs",
        },
    )
    invalid_quantity = client.post(
        "/api/model/relationships",
        json={
            "source_id": usage.json()["id"],
            "target_id": process_usage.json()["id"],
            "kind": "performs",
            "quantity": 2,
        },
    )
    invalid_bounds = client.patch(
        f"/api/model/relationships/{relation.json()['id']}",
        json={"lower_bound": 3, "upper_bound": 1},
    )
    assert relation.status_code == 201
    assert relation.json()["role_name"] == "sheetMaterial"
    assert relation.json()["upper_bound"] == "*"
    assert invalid_relation.status_code == 422
    assert invalid_quantity.status_code == 422
    assert invalid_bounds.status_code == 422

    updated = client.patch(
        f"/api/model/elements/{product_usage.json()['id']}",
        json={"name": "Raw Sheet"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Raw Sheet"

    assert (
        client.delete(f"/api/model/relationships/{relation.json()['id']}").status_code
        == 204
    )
    assert client.delete(f"/api/model/elements/{usage.json()['id']}").status_code == 204
    assert (
        client.delete(f"/api/model/definitions/{product.json()['id']}").status_code
        == 409
    )


def test_definition_domain_is_normalized_and_persisted(client: TestClient) -> None:
    assert client.post("/api/model/reset").status_code == 200

    created = client.post(
        "/api/model/definitions",
        json={"name": "Six-axis robot", "type": "resource", "domain": "  Robotics  "},
    )
    assert created.status_code == 201
    assert created.json()["domain"] == "Robotics"

    updated = client.patch(
        f"/api/model/definitions/{created.json()['id']}",
        json={"domain": " Logistics "},
    )
    assert updated.status_code == 200
    assert updated.json()["domain"] == "Logistics"

    cleared = client.patch(
        f"/api/model/definitions/{created.json()['id']}",
        json={"domain": "   "},
    )
    assert cleared.status_code == 200
    assert cleared.json()["domain"] is None
    assert (
        client.get("/api/model").json()["library"]["definitions"][0]["domain"] is None
    )


def test_definition_inheritance_is_same_type_acyclic_and_delete_safe(
    client: TestClient,
) -> None:
    assert client.post("/api/model/reset").status_code == 200

    parent = client.post(
        "/api/model/definitions",
        json={"name": "Industrial robot", "type": "resource", "domain": "Robotics"},
    )
    child = client.post(
        "/api/model/definitions",
        json={
            "name": "Six-axis welding robot",
            "type": "resource",
            "domain": "Robotics",
            "parent_definition_id": parent.json()["id"],
        },
    )
    assert parent.status_code == 201
    assert child.status_code == 201
    assert child.json()["parent_definition_id"] == parent.json()["id"]

    wrong_type = client.post(
        "/api/model/definitions",
        json={
            "name": "Robot-carried panel",
            "type": "product",
            "parent_definition_id": parent.json()["id"],
        },
    )
    cycle = client.patch(
        f"/api/model/definitions/{parent.json()['id']}",
        json={"parent_definition_id": child.json()["id"]},
    )
    protected_parent = client.delete(f"/api/model/definitions/{parent.json()['id']}")

    assert wrong_type.status_code == 422
    assert cycle.status_code == 422
    assert "cycle" in str(cycle.json()).lower()
    assert protected_parent.status_code == 409
    assert "child definition" in str(protected_parent.json()).lower()
    persisted_parent = next(
        definition
        for definition in client.get("/api/model").json()["library"]["definitions"]
        if definition["id"] == parent.json()["id"]
    )
    assert persisted_parent["parent_definition_id"] is None


def test_save_validation_and_persistence(client, tmp_path) -> None:
    model = client.get("/api/model").json()
    saved = client.put("/api/model", json=model)

    assert saved.status_code == 200
    assert server.DATA_PATH == tmp_path / "ppr_model.json"
    assert server.DATA_PATH.exists()
    persisted = json.loads(server.DATA_PATH.read_text(encoding="utf-8"))
    assert persisted["id"] == model["id"]

    invalid = {
        **model,
        "diagram": {
            **model["diagram"],
            "relationships": [
                {
                    "id": "bad",
                    "source_id": "missing",
                    "target_id": "missing",
                    "kind": "input_to",
                }
            ],
        },
    }
    rejected = client.put("/api/model", json=invalid)
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["error"] == "Model validation failed"


def test_revision_history_records_inspects_restores_and_survives_reload(
    client, tmp_path
) -> None:
    baseline = client.get("/api/model").json()
    initial_history = client.get("/api/model/revisions")
    assert initial_history.status_code == 200
    assert len(initial_history.json()) == 1
    assert initial_history.json()[0]["is_current"] is True

    created = client.post(
        "/api/model/elements",
        json={"name": "History probe", "type": "product"},
    )
    assert created.status_code == 201
    edited = client.patch(
        f"/api/model/elements/{created.json()['id']}",
        json={"name": "Edited history probe"},
    )
    assert edited.status_code == 200

    history = client.get("/api/model/revisions").json()
    assert len(history) == 1
    assert history[0]["is_current"] is False
    assert "owner_token" not in json.dumps(history)

    saved = client.put("/api/model", json=client.get("/api/model").json())
    assert saved.status_code == 200
    saved_history = client.get("/api/model/revisions").json()
    assert len(saved_history) == 2
    assert saved_history[0]["is_current"] is True
    assert saved_history[0]["summary"] == "Saved model snapshot"
    assert saved_history[0]["created_by"] == "Workspace user"

    # Repeated Save clicks without edits do not add another checkpoint.
    repeated_save = client.put("/api/model", json=saved.json())
    assert repeated_save.status_code == 200
    assert len(client.get("/api/model/revisions").json()) == 2

    baseline_revision = saved_history[-1]
    detail = client.get(f"/api/model/revisions/{baseline_revision['id']}")
    assert detail.status_code == 200
    assert detail.json()["model"] == baseline
    assert detail.json()["is_current"] is False

    restored = client.post(f"/api/model/revisions/{baseline_revision['id']}/restore")
    assert restored.status_code == 200
    assert restored.json() == baseline

    after_restore = client.get("/api/model/revisions").json()
    assert len(after_restore) == 3
    assert after_restore[0]["is_current"] is True
    assert after_restore[0]["summary"] == "Restored revision 0"
    assert {item["id"] for item in after_restore} == {
        item["id"] for item in saved_history
    } | {after_restore[0]["id"]}
    assert (
        json.loads((tmp_path / "ppr_model.revisions.json").read_text(encoding="utf-8"))[
            -1
        ]["summary"]
        == "Restored revision 0"
    )

    # Reload the in-memory store from the persisted files, like a server restart.
    server.current_model = server.read_persisted()  # type: ignore[assignment]
    server.revision_history_cache_path = None
    server.revision_history = []
    reloaded = client.get("/api/model/revisions")
    assert reloaded.status_code == 200
    assert reloaded.json() == after_restore


def test_agent_can_create_an_explicit_checkpoint_after_incremental_writes(
    client: TestClient,
) -> None:
    initial_history = client.get("/api/model/revisions").json()
    created = client.post(
        "/api/model/elements",
        json={"name": "Checkpoint probe", "type": "resource"},
    )
    checkpoint = client.post(
        "/api/model/revisions",
        json={"summary": "Agent completed machining cell"},
    )

    assert created.status_code == 201
    assert checkpoint.status_code == 200
    assert checkpoint.json()["summary"] == "Agent completed machining cell"
    assert checkpoint.json()["is_current"] is True
    assert len(client.get("/api/model/revisions").json()) == len(initial_history) + 1


def test_relationship_rules_are_discoverable_and_identity_is_readable(
    client: TestClient,
) -> None:
    rules = client.get("/api/model/relationship-rules")
    definition = client.post(
        "/api/model/definitions",
        json={"name": "Housing", "type": "product"},
    ).json()
    first = client.post(
        "/api/model/elements",
        json={
                "name": "Housing before machining",
            "type": "product",
            "definition_id": definition["id"],
        },
    ).json()
    second = client.post(
        "/api/model/elements",
        json={
                "name": "Housing after machining",
            "type": "product",
            "definition_id": definition["id"],
        },
    ).json()
    identity = client.post(
        "/api/model/relationships",
        json={
            "source_id": first["id"],
            "target_id": second["id"],
            "kind": "becomes",
        },
    )

    assert rules.status_code == 200
    assert rules.json()["becomes"] == [{"source": "product", "target": "product"}]
    assert identity.status_code == 201
    assert (
        client.get(f"/api/model/relationships/{identity.json()['id']}").json()
        == identity.json()
    )


def test_revision_history_prunes_old_snapshots_and_restores_within_retention(
    client, tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(ppr_model, "MAX_REVISION_HISTORY", 3)
    initial_revision_id = client.get("/api/model/revisions").json()[0]["id"]
    snapshots: dict[int, dict] = {}

    for revision_number in range(1, 5):
        model = client.get("/api/model").json()
        model["name"] = f"Retention revision {revision_number}"
        saved = client.put("/api/model", json=model)
        assert saved.status_code == 200
        snapshots[revision_number] = saved.json()

    history = client.get("/api/model/revisions").json()
    assert [item["revision"] for item in history] == [4, 3, 2]
    assert (
        len(
            json.loads(
                (tmp_path / "ppr_model.revisions.json").read_text(encoding="utf-8")
            )
        )
        == 3
    )
    assert client.get(f"/api/model/revisions/{initial_revision_id}").status_code == 404

    retained_revision = client.get("/api/model/revisions/" + history[-1]["id"])
    assert retained_revision.status_code == 200
    assert retained_revision.json()["model"] == snapshots[2]
    assert (
        client.get("/api/model/revisions/" + "revision-does-not-exist").status_code
        == 404
    )

    # Restoring the oldest retained snapshot creates revision 5 and can prune
    # the restored snapshot itself, while leaving the active model correct.
    restored = client.post(f"/api/model/revisions/{history[-1]['id']}/restore")
    assert restored.status_code == 200
    assert restored.json() == snapshots[2]

    after_restore = client.get("/api/model/revisions").json()
    assert [item["revision"] for item in after_restore] == [5, 4, 3]
    assert client.get(f"/api/model/revisions/{history[-1]['id']}").status_code == 404
    assert (
        json.loads((tmp_path / "ppr_model.revisions.json").read_text(encoding="utf-8"))[
            -1
        ]["revision"]
        == 5
    )

    # Pruning is persisted, so a fresh history load exposes the same retained
    # revisions and does not recreate removed snapshots.
    server.current_model = server.read_persisted()  # type: ignore[assignment]
    server.revision_history_cache_path = None
    server.revision_history = []
    reloaded = client.get("/api/model/revisions")
    assert reloaded.status_code == 200
    assert reloaded.json() == after_restore
    assert client.get(f"/api/model/revisions/{history[-1]['id']}").status_code == 404


def test_merge_endpoint_persists_atomic_relationship_repair(client, tmp_path) -> None:
    model = {
        "id": "merge-model",
        "name": "Merge test",
        "description": "",
        "library": {"definitions": []},
        "diagram": {
            "usages": [
                {
                    "id": "first-product",
                    "name": "First",
                    "type": "product",
                    "kind": "usage",
                    "definition_id": None,
                    "description": "First description",
                    "attributes": [{"id": "first-attr", "name": "grade", "value": "A"}],
                    "x": 10,
                    "y": 20,
                },
                {
                    "id": "second-product",
                    "name": "Second",
                    "type": "product",
                    "kind": "usage",
                    "definition_id": None,
                    "description": "Second description",
                    "attributes": [
                        {"id": "second-attr", "name": "grade", "value": "B"}
                    ],
                    "x": 40,
                    "y": 50,
                },
                {
                    "id": "weld-process",
                    "name": "Weld",
                    "type": "process",
                    "kind": "usage",
                    "definition_id": None,
                    "description": "",
                    "attributes": [],
                    "x": 100,
                    "y": 100,
                },
            ],
            "relationships": [
                {
                    "id": "first-input",
                    "source_id": "first-product",
                    "target_id": "weld-process",
                    "kind": "input_to",
                    "quantity": 2,
                    "unit": "kg",
                },
                {
                    "id": "second-input",
                    "source_id": "second-product",
                    "target_id": "weld-process",
                    "kind": "input_to",
                },
            ],
        },
    }
    assert client.put("/api/model", json=model).status_code == 200

    merged = client.post(
        "/api/model/merge",
        json={
            "first_id": "first-product",
            "second_id": "second-product",
            "survivor_id": "second-product",
            "name_source": "second",
            "description_source": "first",
            "definition_source": "none",
            "attribute_decisions": [{"name": "grade", "source": "second"}],
            "self_loop_policy": "reject",
        },
    )

    assert merged.status_code == 200
    payload = merged.json()
    assert [usage["id"] for usage in payload["diagram"]["usages"]] == [
        "second-product",
        "weld-process",
    ]
    assert len(payload["diagram"]["relationships"]) == 1
    assert payload["diagram"]["relationships"][0]["id"] == "first-input"
    assert payload["diagram"]["relationships"][0]["source_id"] == "second-product"
    assert payload["diagram"]["relationships"][0]["quantity"] == 2
    assert (
        json.loads((tmp_path / "ppr_model.json").read_text())["diagram"]["usages"][0][
            "id"
        ]
        == "second-product"
    )


def test_merge_endpoint_rejects_without_mutating_live_model(client) -> None:
    model = {
        "id": "self-loop-model",
        "name": "Self loop test",
        "description": "",
        "library": {"definitions": []},
        "diagram": {
            "usages": [
                {
                    "id": "first",
                    "name": "First",
                    "type": "process",
                    "kind": "usage",
                    "definition_id": None,
                    "description": "",
                    "attributes": [],
                    "x": 0,
                    "y": 0,
                },
                {
                    "id": "second",
                    "name": "Second",
                    "type": "process",
                    "kind": "usage",
                    "definition_id": None,
                    "description": "",
                    "attributes": [],
                    "x": 0,
                    "y": 0,
                },
            ],
            "relationships": [
                {
                    "id": "sequence",
                    "source_id": "first",
                    "target_id": "second",
                    "kind": "succeeds",
                }
            ],
        },
    }
    assert client.put("/api/model", json=model).status_code == 200

    rejected = client.post(
        "/api/model/merge",
        json={
            "first_id": "first",
            "second_id": "second",
            "survivor_id": "first",
            "name_source": "first",
            "description_source": "first",
            "definition_source": "none",
            "self_loop_policy": "reject",
        },
    )

    assert rejected.status_code == 422
    current = client.get("/api/model").json()
    assert [usage["id"] for usage in current["diagram"]["usages"]] == [
        "first",
        "second",
    ]
    assert current["diagram"]["relationships"][0]["id"] == "sequence"


def test_example_reset_validate_and_exports(client) -> None:
    reset = client.post("/api/model/reset")
    assert reset.status_code == 200
    assert reset.json()["library"]["definitions"] == []
    assert reset.json()["diagram"]["usages"] == []

    example = client.post("/api/model/example")
    assert example.status_code == 200
    validation = client.post("/api/model/validate", json=example.json())
    assert validation.status_code == 200
    assert validation.json()["valid"] is True

    for format_name, expected in [
            ("json", '"Two-Stage Finished Product"'),
            ("sysml", "item def <def_raw_material> 'Raw Material' :> Product"),
            ("sysml-ppr", "#product def <def_raw_material> 'Raw Material'"),
        ("automationml", "<CAEXFile"),
    ]:
        exported = client.get(f"/api/model/export/{format_name}")
        assert exported.status_code == 200
        assert expected in exported.json()["content"]


def test_sysml_import_endpoint_projects_fixture(client) -> None:
    source = (
        Path(__file__).resolve().parents[1]
        / "examples"
        / "sysml"
        / "01_minimal_flow.portable.sysml"
    ).read_text(encoding="utf-8")
    response = client.post(
        "/api/model/import/sysml",
        content=source,
        headers={"content-type": "text/plain"},
    )
    assert response.status_code == 200
    imported = response.json()
    assert imported["name"] == "Minimal Pressing"
    assert len(imported["library"]["definitions"]) == 4
    assert len(imported["diagram"]["relationships"]) == 3


def test_automationml_import_endpoint_projects_exported_model(client) -> None:
    source = example_model()
    response = client.post(
        "/api/model/import/automationml",
        content=export_automationml(source),
        headers={"content-type": "application/xml"},
    )

    assert response.status_code == 200
    imported = response.json()
    assert imported["name"] == source.name
    assert len(imported["library"]["definitions"]) == len(source.library.definitions)
    assert len(imported["diagram"]["usages"]) == len(source.diagram.usages)
    assert len(imported["diagram"]["relationships"]) == len(
        source.diagram.relationships
    )
    assert any(
        attribute["name"] == "asset id"
        for usage in imported["diagram"]["usages"]
        for attribute in usage["attributes"]
    )


def test_automationml_import_errors_identify_invalid_element(client) -> None:
    response = client.post(
        "/api/model/import/automationml",
        content=(
            '<CAEXFile><InstanceHierarchy Name="Broken" ID="broken">'
            '<InternalElement Name="Missing role" ID="bad-element" />'
            "</InstanceHierarchy></CAEXFile>"
        ),
        headers={"content-type": "application/xml"},
    )

    assert response.status_code == 422
    assert "Element 'bad-element'" in response.json()["detail"]["error"]


def test_automationml_import_errors_identify_invalid_relationship(client) -> None:
    response = client.post(
        "/api/model/import/automationml",
        content=(
            '<CAEXFile><InstanceHierarchy Name="Broken" ID="broken">'
            '<InternalElement Name="Product" ID="product">'
            '<RoleRequirements RefBaseRoleClassPath="PPR/Product/Usage" />'
            "</InternalElement>"
            '<InternalElement Name="Process" ID="process">'
            '<RoleRequirements RefBaseRoleClassPath="PPR/Process/Usage" />'
            "</InternalElement>"
            '<InternalLink Name="bad-relationship" RefPartnerSideA="product" '
            'RefPartnerSideB="process"><Attribute Name="kind">'
            '<Value>produces</Value></Attribute><Attribute Name="unit">'
            "<Value>kg</Value></Attribute></InternalLink>"
            "</InstanceHierarchy></CAEXFile>"
        ),
        headers={"content-type": "application/xml"},
    )

    assert response.status_code == 422
    assert "relationship 'bad-relationship'" in response.json()["detail"]["error"]


@pytest.mark.parametrize(
    "scenario_id",
    [scenario.id for scenario in get_ppr_scenarios() if scenario.loadable],
)
def test_loadable_scenarios_support_save_validate_reset_and_export(
    client, scenario_id: str
) -> None:
    scenario = next(item for item in get_ppr_scenarios() if item.id == scenario_id)
    model = scenario.model.model_dump(mode="json")

    saved = client.put("/api/model", json=model)
    assert saved.status_code == 200
    assert saved.json()["name"] == scenario.model.name

    validation = client.post("/api/model/validate", json=model)
    assert validation.status_code == 200
    assert validation.json()["valid"] is True

    for format_name in ("json", "sysml", "automationml"):
        exported = client.get(f"/api/model/export/{format_name}")
        assert exported.status_code == 200
        assert exported.json()["content"]

    reset = client.post("/api/model/reset")
    assert reset.status_code == 200
    assert reset.json()["library"]["definitions"] == []
    assert reset.json()["diagram"]["usages"] == []
