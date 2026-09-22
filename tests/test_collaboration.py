from __future__ import annotations

import asyncio

from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient
from uvicorn import Config

from backend import main as server
from backend.collaboration import CollaborationManager, Participant
from backend.exporters import export_automationml
from backend.model import ppr as ppr_model
from backend.model.ppr import example_model
from backend.sysml import export_sysml


def test_deployed_server_has_a_websocket_protocol() -> None:
    config = Config("backend.main:app")
    config.load()
    assert config.ws_protocol_class is not None


def test_presence_broadcast_prunes_disconnected_participants() -> None:
    class DisconnectedWebSocket:
        async def send_json(self, payload: dict[str, object]) -> None:
            raise WebSocketDisconnect()

    manager = CollaborationManager()
    session = manager.create(example_model())
    session.participants["stale"] = Participant(
        id="stale",
        name="Disconnected",
        websocket=DisconnectedWebSocket(),  # type: ignore[arg-type]
    )

    asyncio.run(manager.broadcast(session, {"type": "presence.updated"}))

    assert session.participants == {}


def _create_session(client: TestClient) -> dict[str, str]:
    identity = client.get("/api/auth/session")
    assert identity.status_code == 200
    response = client.post("/api/collaboration/sessions")
    assert response.status_code == 200
    return response.json()


def test_session_model_is_isolated_from_the_default_workspace(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    original_name = server.current_model.name
    with TestClient(server.app) as client:
        session = _create_session(client)
        headers = {
            "x-collaboration-session": session["session_id"],
            "x-collaboration-code": session["code"],
        }
        collaborative_model = client.get("/api/model", headers=headers).json()
        collaborative_model["name"] = "Shared production model"
        saved = client.put("/api/model", headers=headers, json=collaborative_model)
        assert saved.status_code == 200
        assert client.get("/api/model", headers=headers).json()["name"] == "Shared production model"
        assert client.get("/api/model").json()["name"] == original_name


def test_collaboration_revision_history_is_scoped_and_restore_broadcasts(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        headers = {
            "x-collaboration-session": session["session_id"],
            "x-collaboration-code": session["code"],
        }
        baseline = client.get("/api/model", headers=headers).json()
        changed = {**baseline, "name": "Shared revision"}
        assert (
            client.put(
                "/api/model",
                headers=headers,
                params={"checkpoint": "false"},
                json=changed,
            ).status_code
            == 200
        )

        session_history = client.get("/api/model/revisions", headers=headers)
        global_history = client.get("/api/model/revisions")
        assert session_history.status_code == 200
        assert len(session_history.json()) == 1
        assert session_history.json()[0]["is_current"] is False
        assert len(global_history.json()) == 1

        saved = client.put(
            "/api/model",
            headers=headers,
            params={"checkpoint": "true"},
            json=changed,
        )
        assert saved.status_code == 200
        session_history = client.get("/api/model/revisions", headers=headers)
        assert len(session_history.json()) == 2
        assert session_history.json()[0]["summary"] == "Saved model snapshot"
        assert session_history.json()[0]["is_current"] is True
        baseline_revision_id = session_history.json()[-1]["id"]

        path = f"/api/collaboration/ws/{session['session_id']}?code={session['code']}"
        with client.websocket_connect(f"{path}&name=Reviewer") as reviewer:
            assert reviewer.receive_json()["type"] == "session.ready"
            restored = client.post(
                f"/api/model/revisions/{baseline_revision_id}/restore",
                headers=headers,
            )
            assert restored.status_code == 200
            assert restored.json() == baseline
            update = reviewer.receive_json()
            assert update["type"] == "model.updated"
            assert update["revision"] == 2
            assert update["model"]["name"] == baseline["name"]

        after_restore = client.get("/api/model/revisions", headers=headers).json()
        assert len(after_restore) == 3
        assert after_restore[0]["is_current"] is True
        assert after_restore[0]["summary"] == "Restored revision 0"


def test_collaboration_revision_history_is_bounded(monkeypatch) -> None:
    monkeypatch.setattr(ppr_model, "MAX_REVISION_HISTORY", 2)
    manager = CollaborationManager()
    session = manager.create(example_model())

    for revision_number in range(1, 4):
        model = session.model.model_copy(update={"name": f"Shared revision {revision_number}"})
        history_length = len(session.revisions)
        manager.replace_model(session, model)
        assert len(session.revisions) == history_length
        assert session.revisions[-1].model.name != model.name
        manager.save_model(session, model)

    assert [revision.revision for revision in session.revisions] == [2, 3]
    assert session.revisions[-1].model.name == "Shared revision 3"
    assert session.model.name == "Shared revision 3"


def test_access_code_and_owner_token_are_enforced(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        rejected = client.post(
            "/api/collaboration/join",
            json={"session_id": session["session_id"], "code": "000000"},
        )
        assert rejected.status_code == 404
        forbidden = client.post(
            f"/api/collaboration/sessions/{session['session_id']}/close",
            json={"owner_token": "wrong-token"},
        )
        assert forbidden.status_code == 403
        closed = client.post(
            f"/api/collaboration/sessions/{session['session_id']}/close",
            json={"owner_token": session["owner_token"]},
        )
        assert closed.status_code == 204


def test_authenticated_membership_is_required_and_owner_close_is_scoped(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as owner, TestClient(server.app) as editor:
        assert owner.post("/api/collaboration/sessions").status_code == 401
        owner.get("/api/auth/session")
        editor.get("/api/auth/session")
        session = _create_session(owner)

        assert editor.get(
            "/api/model",
            headers={
                "x-collaboration-session": session["session_id"],
                "x-collaboration-code": session["code"],
            },
        ).status_code == 403
        joined = editor.post(
            "/api/collaboration/join",
            json={"session_id": session["session_id"], "code": session["code"]},
        )
        assert joined.status_code == 200
        membership = joined.json()
        assert membership["role"] == "editor"
        assert membership["member_token"]

        assert editor.get(
            "/api/model",
            headers={
                "x-collaboration-session": session["session_id"],
                "x-collaboration-token": membership["member_token"],
            },
        ).status_code == 200
        assert editor.post(
            f"/api/collaboration/sessions/{session['session_id']}/close",
            headers={
                "x-collaboration-session": session["session_id"],
                "x-collaboration-token": membership["member_token"],
            },
            json={},
        ).status_code == 403

        closed = owner.post(
            f"/api/collaboration/sessions/{session['session_id']}/close",
            headers={
                "x-collaboration-session": session["session_id"],
                "x-collaboration-token": session["member_token"],
            },
            json={},
        )
        assert closed.status_code == 204
        assert editor.get(
            "/api/model",
            headers={
                "x-collaboration-session": session["session_id"],
                "x-collaboration-token": membership["member_token"],
            },
        ).status_code == 403


def test_authenticated_identity_cookie_and_cors_policy(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    with TestClient(server.app) as client:
        assert client.post("/api/collaboration/sessions").status_code == 401
        identity = client.get("/api/auth/session")
        assert identity.status_code == 200
        assert identity.cookies.get("ppr_identity")

        allowed = client.options(
            "/api/collaboration/sessions",
            headers={
                "Origin": "http://localhost:23220",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "x-collaboration-token",
            },
        )
        assert allowed.status_code == 200
        assert allowed.headers["access-control-allow-origin"] == "http://localhost:23220"

        denied = client.options(
            "/api/collaboration/sessions",
            headers={
                "Origin": "https://attacker.example",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert "access-control-allow-origin" not in denied.headers


def test_websocket_origin_policy_accepts_the_hosted_app_and_rejects_other_hosts() -> None:
    assert server.websocket_origin_allowed(
        "https://ppr-modeler.example",
        "ppr-modeler.example",
    )
    assert server.websocket_origin_allowed(
        "https://ppr-modeler.example",
        "internal-service:8000",
        "ppr-modeler.example",
    )
    assert not server.websocket_origin_allowed(
        "https://attacker.example",
        "ppr-modeler.example",
    )
    assert not server.websocket_origin_allowed("null", "ppr-modeler.example")


def test_websocket_accepts_a_same_host_origin_in_a_hosted_deployment(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        path = f"/api/collaboration/ws/{session['session_id']}?code={session['code']}"
        with client.websocket_connect(
            f"{path}&name=Hosted",
            headers={
                "host": "ppr-modeler.example",
                "origin": "https://ppr-modeler.example",
            },
        ) as websocket:
            assert websocket.receive_json()["type"] == "session.ready"


def test_websocket_broadcasts_presence_and_model_updates(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        path = f"/api/collaboration/ws/{session['session_id']}?code={session['code']}"
        with client.websocket_connect(f"{path}&name=Owner") as owner:
            owner_ready = owner.receive_json()
            assert owner_ready["type"] == "session.ready"
            with client.websocket_connect(f"{path}&name=Guest") as guest:
                guest_ready = guest.receive_json()
                assert guest_ready["type"] == "session.ready"
                presence = owner.receive_json()
                assert presence["type"] == "presence.updated"
                assert {item["name"] for item in presence["participants"]} == {
                    "Owner",
                    "Guest",
                }
                updated_model = guest_ready["model"]
                updated_model["name"] = "Edited together"
                guest.send_json(
                    {"type": "model.update", "baseRevision": 0, "model": updated_model}
                )
                acknowledgement = guest.receive_json()
                assert acknowledgement == {"type": "model.ack", "revision": 1}
                update = owner.receive_json()
                assert update["type"] == "model.updated"
                assert update["model"]["name"] == "Edited together"
                assert update["revision"] == 1

                # Full-model HTTP operations advance the revision and notify all
                # connected browser clients before a debounced WebSocket retry arrives.
                replaced_model = update["model"]
                replaced_model["name"] = "Replaced over HTTP"
                headers = {
                    "x-collaboration-session": session["session_id"],
                    "x-collaboration-code": session["code"],
                }
                saved = client.put("/api/model", headers=headers, json=replaced_model)
                assert saved.status_code == 200
                http_update = owner.receive_json()
                assert http_update["type"] == "model.updated"
                assert http_update["model"]["name"] == "Replaced over HTTP"
                assert http_update["revision"] == 2
                guest_http_update = guest.receive_json()
                assert guest_http_update["type"] == "model.updated"
                assert guest_http_update["model"]["name"] == "Replaced over HTTP"
                assert guest_http_update["revision"] == 2
                guest.send_json(
                    {"type": "model.update", "baseRevision": 1, "model": replaced_model}
                )
                acknowledgement = guest.receive_json()
                assert acknowledgement == {"type": "model.ack", "revision": 2}


def test_rest_model_mutations_broadcast_to_every_collaborator(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        path = f"/api/collaboration/ws/{session['session_id']}?code={session['code']}"
        headers = {
            "x-collaboration-session": session["session_id"],
            "x-collaboration-code": session["code"],
        }
        with client.websocket_connect(f"{path}&name=Owner") as owner:
            owner_ready = owner.receive_json()
            with client.websocket_connect(f"{path}&name=Guest") as guest:
                guest_ready = guest.receive_json()
                assert owner.receive_json()["type"] == "presence.updated"

                def assert_broadcast(response, expected_model_name: str | None = None):
                    assert response.status_code in {200, 201, 204}
                    owner_update = owner.receive_json()
                    guest_update = guest.receive_json()
                    for update in (owner_update, guest_update):
                        assert update["type"] == "model.updated"
                        assert update["participantId"] == "model-api"
                        if expected_model_name is not None:
                            assert update["model"]["name"] == expected_model_name
                    assert owner_update["model"] == guest_update["model"]
                    return owner_update["model"]

                created_element = client.post(
                    "/api/model/elements",
                    headers=headers,
                    json={"name": "REST-created usage", "type": "product"},
                )
                created_model = assert_broadcast(created_element)
                created_id = created_element.json()["id"]
                assert any(
                    item["id"] == created_id
                    for item in created_model["diagram"]["usages"]
                )

                updated_element = client.patch(
                    f"/api/model/elements/{created_id}",
                    headers=headers,
                    json={"name": "REST-updated usage"},
                )
                updated_model = assert_broadcast(updated_element)
                assert next(
                    item for item in updated_model["diagram"]["usages"]
                    if item["id"] == created_id
                )["name"] == "REST-updated usage"

                created_definition = client.post(
                    "/api/model/definitions",
                    headers=headers,
                    json={"name": "REST-created definition", "type": "product"},
                )
                definition_model = assert_broadcast(created_definition)
                definition_id = created_definition.json()["id"]
                assert any(
                    item["id"] == definition_id
                    for item in definition_model["library"]["definitions"]
                )

                updated_definition = client.patch(
                    f"/api/model/definitions/{definition_id}",
                    headers=headers,
                    json={"name": "REST-updated definition"},
                )
                updated_definition_model = assert_broadcast(updated_definition)
                assert next(
                    item for item in updated_definition_model["library"]["definitions"]
                    if item["id"] == definition_id
                )["name"] == "REST-updated definition"

                deleted_definition = client.delete(
                    f"/api/model/definitions/{definition_id}",
                    headers=headers,
                )
                deleted_definition_model = assert_broadcast(deleted_definition)
                assert all(
                    item["id"] != definition_id
                    for item in deleted_definition_model["library"]["definitions"]
                )

                first_product, second_product = [
                    item
                    for item in deleted_definition_model["diagram"]["usages"]
                    if item["type"] == "product"
                ][:2]
                merged = client.post(
                    "/api/model/merge",
                    headers=headers,
                    json={
                        "first_id": first_product["id"],
                        "second_id": second_product["id"],
                        "survivor_id": first_product["id"],
                        "name_source": "first",
                        "description_source": "first",
                        "definition_source": "first",
                        "self_loop_policy": "drop",
                    },
                )
                merged_model = assert_broadcast(merged)
                assert second_product["id"] not in {
                    item["id"] for item in merged_model["diagram"]["usages"]
                }

                imported = client.post(
                    "/api/model/import/sysml",
                    headers=headers,
                    content=export_sysml(example_model(), mode="portable"),
                )
                imported_model = assert_broadcast(imported)
                assert imported_model == imported.json()

                imported_automationml = client.post(
                    "/api/model/import/automationml",
                    headers=headers,
                    content=export_automationml(example_model()),
                )
                assert_broadcast(imported_automationml)

                loaded_example = client.post("/api/model/example", headers=headers)
                assert_broadcast(loaded_example)

                reset = client.post("/api/model/reset", headers=headers)
                reset_model = assert_broadcast(reset)
                assert reset_model["diagram"]["usages"] == []
                assert reset_model["library"]["definitions"] == []


def test_websocket_broadcasts_ephemeral_cursor_updates(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        path = f"/api/collaboration/ws/{session['session_id']}?code={session['code']}"
        with client.websocket_connect(f"{path}&name=Owner") as owner:
            owner_ready = owner.receive_json()
            with client.websocket_connect(f"{path}&name=Guest") as guest:
                guest_ready = guest.receive_json()
                assert owner.receive_json()["type"] == "presence.updated"
                assert {item["name"] for item in guest_ready["participants"]} == {"Owner", "Guest"}

                guest.send_json({"type": "cursor.move", "cursor": {"x": 240, "y": 120}})
                cursor_update = owner.receive_json()
                assert cursor_update == {
                    "type": "cursor.updated",
                    "participantId": guest_ready["participantId"],
                    "cursor": {"x": 240.0, "y": 120.0},
                }

                guest.send_json({"type": "cursor.clear"})
                assert owner.receive_json() == {
                    "type": "cursor.updated",
                    "participantId": guest_ready["participantId"],
                    "cursor": None,
                }
                assert owner_ready["model"] == guest_ready["model"]


def test_websocket_broadcasts_ephemeral_surface_updates_and_clears_them_on_leave(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        path = f"/api/collaboration/ws/{session['session_id']}?code={session['code']}"
        with client.websocket_connect(f"{path}&name=Owner") as owner:
            owner_ready = owner.receive_json()
            with client.websocket_connect(f"{path}&name=Guest") as guest:
                guest_ready = guest.receive_json()
                assert owner.receive_json()["type"] == "presence.updated"

                guest.send_json({"type": "surface.update", "surface": "product"})
                assert owner.receive_json() == {
                    "type": "surface.updated",
                    "participantId": guest_ready["participantId"],
                    "surface": "product",
                }

                with client.websocket_connect(f"{path}&name=Observer") as observer:
                    observer_ready = observer.receive_json()
                    assert {
                        item["name"]: item.get("surface")
                        for item in observer_ready["participants"]
                    } == {"Owner": None, "Guest": "product", "Observer": None}
                    assert owner.receive_json()["type"] == "presence.updated"

                observer_departed = owner.receive_json()
                assert observer_departed["type"] == "presence.updated"
                assert all(
                    participant["id"] != observer_ready["participantId"]
                    for participant in observer_departed["participants"]
                )

            departed = owner.receive_json()
            assert departed["type"] == "presence.updated"
            assert all(
                participant["id"] != guest_ready["participantId"]
                for participant in departed["participants"]
            )
            assert owner_ready["model"] == observer_ready["model"]


def test_websocket_rejects_unknown_surface_without_changing_presence(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        path = f"/api/collaboration/ws/{session['session_id']}?code={session['code']}"
        with client.websocket_connect(f"{path}&name=Owner") as owner:
            owner_ready = owner.receive_json()
            owner.send_json({"type": "surface.update", "surface": "dashboard"})
            error = owner.receive_json()
            assert error["type"] == "error"
            assert "Workspace surface" in error["message"]

            with client.websocket_connect(f"{path}&name=Observer") as observer:
                observer_ready = observer.receive_json()
                owner.receive_json()
                owner_presence = observer_ready["participants"]
                owner_presence_entry = next(
                    participant
                    for participant in owner_presence
                    if participant["id"] == owner_ready["participantId"]
                )
                assert "surface" not in owner_presence_entry


def test_websocket_broadcasts_ephemeral_selection_updates_with_distinct_colors(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        path = f"/api/collaboration/ws/{session['session_id']}?code={session['code']}"
        with client.websocket_connect(f"{path}&name=Owner") as owner:
            owner_ready = owner.receive_json()
            with client.websocket_connect(f"{path}&name=Guest") as guest:
                guest_ready = guest.receive_json()
                assert owner.receive_json()["type"] == "presence.updated"
                owner_color = next(
                    participant["color"]
                    for participant in guest_ready["participants"]
                    if participant["id"] == owner_ready["participantId"]
                )
                guest_color = next(
                    participant["color"]
                    for participant in guest_ready["participants"]
                    if participant["id"] == guest_ready["participantId"]
                )
                assert owner_color != guest_color

                selected_id = server.current_model.diagram.usages[0].id
                guest.send_json({"type": "selection.update", "selection": [selected_id]})
                assert owner.receive_json() == {
                    "type": "selection.updated",
                    "participantId": guest_ready["participantId"],
                    "selection": [selected_id],
                }

                with client.websocket_connect(f"{path}&name=Observer") as observer:
                    observer_ready = observer.receive_json()
                    guest_presence = next(
                        participant
                        for participant in observer_ready["participants"]
                        if participant["id"] == guest_ready["participantId"]
                    )
                    assert guest_presence["selection"] == [selected_id]
                    assert guest_presence["color"] != owner_color


def test_websocket_retries_with_a_client_update_id_without_creating_a_revision(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        path = f"/api/collaboration/ws/{session['session_id']}?code={session['code']}"
        with client.websocket_connect(f"{path}&name=Editor") as editor:
            ready = editor.receive_json()
            updated_model = ready["model"]
            updated_model["name"] = "Recovered edit"
            update = {
                "type": "model.update",
                "baseRevision": 0,
                "clientUpdateId": "editor-update-1",
                "model": updated_model,
            }

            editor.send_json(update)
            assert editor.receive_json() == {
                "type": "model.ack",
                "revision": 1,
                "clientUpdateId": "editor-update-1",
            }

            # A reconnect can resend the same update after losing its first ack.
            editor.send_json(update)
            assert editor.receive_json() == {
                "type": "model.ack",
                "revision": 1,
                "clientUpdateId": "editor-update-1",
            }

        headers = {
            "x-collaboration-session": session["session_id"],
            "x-collaboration-code": session["code"],
        }
        history = client.get("/api/model/revisions", headers=headers).json()
        assert len(history) == 1
        assert history[0]["revision"] == 0
        assert history[0]["is_current"] is False


def test_collaborators_can_edit_across_workspace_views_and_save_one_checkpoint_after_reconnect(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        path = f"/api/collaboration/ws/{session['session_id']}?code={session['code']}"
        headers = {
            "x-collaboration-session": session["session_id"],
            "x-collaboration-code": session["code"],
        }

        with client.websocket_connect(f"{path}&name=Owner") as owner:
            owner_ready = owner.receive_json()
            with client.websocket_connect(f"{path}&name=Reviewer") as reviewer:
                reviewer_ready = reviewer.receive_json()
                assert owner.receive_json()["type"] == "presence.updated"

                # Surface and selection changes are ephemeral collaboration state.
                # They must not advance the shared model revision or create history.
                for surface in ("library", "graph", "process", "product", "resource"):
                    reviewer.send_json({"type": "surface.update", "surface": surface})
                    assert owner.receive_json() == {
                        "type": "surface.updated",
                        "participantId": reviewer_ready["participantId"],
                        "surface": surface,
                    }
                selected_id = reviewer_ready["model"]["diagram"]["usages"][0]["id"]
                reviewer.send_json({"type": "selection.update", "selection": [selected_id]})
                assert owner.receive_json() == {
                    "type": "selection.updated",
                    "participantId": reviewer_ready["participantId"],
                    "selection": [selected_id],
                }

                edited_model = reviewer_ready["model"]
                edited_model["name"] = "Cross-view production review"
                update = {
                    "type": "model.update",
                    "baseRevision": 0,
                    "clientUpdateId": "cross-view-edit",
                    "model": edited_model,
                }
                reviewer.send_json(update)
                assert reviewer.receive_json() == {
                    "type": "model.ack",
                    "revision": 1,
                    "clientUpdateId": "cross-view-edit",
                }
                broadcast = owner.receive_json()
                assert broadcast["type"] == "model.updated"
                assert broadcast["revision"] == 1
                assert broadcast["model"] == edited_model

            # The same update can be retried after reconnect without creating
            # another live revision or changing the saved-history baseline.
            with client.websocket_connect(f"{path}&name=Reviewer reconnected") as reviewer:
                reconnected = reviewer.receive_json()
                assert reconnected["revision"] == 1
                assert reconnected["model"] == edited_model
                reviewer.send_json(update)
                assert reviewer.receive_json() == {
                    "type": "model.ack",
                    "revision": 1,
                    "clientUpdateId": "cross-view-edit",
                }

            before_save = client.get("/api/model/revisions", headers=headers)
            assert before_save.status_code == 200
            assert len(before_save.json()) == 1
            assert client.get("/api/model", headers=headers).json() == edited_model
            assert client.get("/api/model").json() == server.current_model.model_dump(mode="json")

            saved = client.put(
                "/api/model",
                headers=headers,
                params={"checkpoint": "true"},
                json=edited_model,
            )
            assert saved.status_code == 200
            assert saved.json() == edited_model
            saved_history = client.get("/api/model/revisions", headers=headers).json()
            assert len(saved_history) == 2
            assert saved_history[0]["summary"] == "Saved model snapshot"
            assert saved_history[0]["is_current"] is True
            assert saved_history[0]["model_name"] == "Cross-view production review"

            # A second Save is a no-op checkpoint, even though it still
            # returns the current shared model to the caller.
            repeated = client.put(
                "/api/model",
                headers=headers,
                params={"checkpoint": "true"},
                json=edited_model,
            )
            assert repeated.status_code == 200
            assert repeated.json() == edited_model
            assert len(client.get("/api/model/revisions", headers=headers).json()) == 2
            assert client.get("/api/model", headers=headers).json() == edited_model
            assert client.get("/api/model", headers=headers).json() == edited_model


def test_websocket_reports_a_conflict_for_a_retried_update_after_a_newer_revision(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(server, "DATA_PATH", tmp_path / "ppr_model.json")
    server.current_model = example_model()
    with TestClient(server.app) as client:
        session = _create_session(client)
        path = f"/api/collaboration/ws/{session['session_id']}?code={session['code']}"
        with client.websocket_connect(f"{path}&name=Editor") as editor:
            ready = editor.receive_json()
            stale_model = ready["model"]
            stale_model["name"] = "Offline edit"
            stale_update = {
                "type": "model.update",
                "baseRevision": 0,
                "clientUpdateId": "editor-update-2",
                "model": stale_model,
            }

            editor.send_json(stale_update)
            assert editor.receive_json()["type"] == "model.ack"

            headers = {
                "x-collaboration-session": session["session_id"],
                "x-collaboration-code": session["code"],
            }
            newer_model = {**stale_model, "name": "Another engineer's edit"}
            assert client.put("/api/model", headers=headers, json=newer_model).status_code == 200
            http_update = editor.receive_json()
            assert http_update["type"] == "model.updated"
            assert http_update["model"]["name"] == "Another engineer's edit"

            editor.send_json(stale_update)
            conflict = editor.receive_json()
            assert conflict["type"] == "model.conflict"
            assert conflict["clientUpdateId"] == "editor-update-2"
            assert conflict["model"]["name"] == "Another engineer's edit"
