from __future__ import annotations

import math
import json
import os
import asyncio
import base64
import hashlib
import hmac
import secrets
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, cast
from urllib.parse import urlsplit

from fastapi import (
    Body,
    FastAPI,
    HTTPException,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    Query,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .collaboration import (
    CollaborationError,
    CollaborationAuthorizationError,
    CollaborationIdentity,
    CollaborationSession,
    CursorPosition,
    MAX_APPLIED_COLLABORATION_UPDATES,
    MEMBERSHIP_TTL,
    PARTICIPANT_IDLE_TIMEOUT,
    Participant,
    WORKSPACE_SURFACES,
    WorkspaceSurface,
    collaboration_manager,
)
from .exporters import (
    AutomationMlExportError,
    AutomationMlImportError,
    export_automationml,
    export_sysml,
    import_automationml,
)
from .model.core import Attribute, new_id
from .model.ppr import (
    ALLOWED_RELATIONS,
    IdentityInferenceRequest,
    IdentityInferenceResult,
    MergeUsagesRequest,
    PprElement,
    PprItem,
    PprModel,
    PprRelationship,
    PprRevision,
    RELATIONSHIP_RULES,
    RELATIONSHIP_KIND_ALIASES,
    RelationKind,
    RelationshipInputKind,
    RelationshipJoin,
    RelationshipModality,
    RelationshipRateBasis,
    ValidationResult,
    derive_ppr_items,
    example_model,
    infer_identity,
    make_ppr_revision,
    merge_ppr_usages,
    retain_ppr_revisions,
    validate_ppr_model,
)
from .mcp_server import configure_in_process_api, deployed_mcp
from .sysml import SysmlExportError
from .sysml_import import SysmlImportError, import_sysml

@asynccontextmanager
async def application_lifespan(application: FastAPI):
    configure_in_process_api(application)
    async with deployed_mcp.lifespan():
        yield


app = FastAPI(
    title="PPR Engineering Modeler API",
    version="0.1.0",
    lifespan=application_lifespan,
)
app.add_route(
    "/api/mcp",
    deployed_mcp,
    methods=["GET", "POST", "DELETE"],
    name="mcp-no-slash",
)
app.mount("/api/mcp", deployed_mcp, name="mcp")
ALLOWED_ORIGINS = tuple(
    origin.strip()
    for origin in os.environ.get(
        "PPR_ALLOWED_ORIGINS",
        "http://localhost:23220,http://127.0.0.1:23220,http://localhost:23221,http://127.0.0.1:23221,http://localhost:3000",
    ).split(",")
    if origin.strip()
)
SESSION_SECRET = os.environ.get("SESSION_SECRET", "local-development-session-secret")
IDENTITY_COOKIE = "ppr_identity"


def websocket_origin_allowed(
    origin: str | None,
    host: str | None,
    forwarded_host: str | None = None,
) -> bool:
    """Allow configured origins and the public host serving the application.

    Hosted deployments normally terminate TLS at a reverse proxy, so the ASGI
    server cannot reliably compare schemes. Host and port still provide the
    same-origin boundary needed for browser WebSocket requests.
    """

    if origin is None:
        return True
    if origin in ALLOWED_ORIGINS:
        return True
    try:
        parsed_origin = urlsplit(origin)
        if (
            parsed_origin.scheme not in {"http", "https"}
            or not parsed_origin.hostname
            or parsed_origin.username is not None
            or parsed_origin.password is not None
            or parsed_origin.path not in {"", "/"}
            or parsed_origin.query
            or parsed_origin.fragment
        ):
            return False
        origin_port = parsed_origin.port or (
            443 if parsed_origin.scheme == "https" else 80
        )
    except ValueError:
        return False

    for candidate in (forwarded_host, host):
        if not candidate:
            continue
        # Proxies may append a comma-separated forwarding chain. The first
        # value is the public host supplied by the original client.
        candidate = candidate.split(",", 1)[0].strip()
        try:
            parsed_host = urlsplit(f"//{candidate}")
            if not parsed_host.hostname:
                continue
            candidate_port = parsed_host.port or origin_port
        except ValueError:
            continue
        if (
            parsed_host.hostname.casefold() == parsed_origin.hostname.casefold()
            and candidate_port == origin_port
        ):
            return True
    return False


def membership_cookie_name(session_id: str) -> str:
    return f"ppr_collab_{session_id}"
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Accept",
        "Authorization",
        "Content-Type",
        "X-Collaboration-Code",
        "X-Collaboration-Session",
        "X-Collaboration-Token",
    ],
)

DATA_PATH = Path(
    os.environ.get(
        "PPR_MODEL_DATA_PATH",
        str(Path(__file__).resolve().parent.parent / "data" / "ppr_model.json"),
    )
)
current_model = example_model()
revision_history_cache_path: Path | None = None
revision_history: list[PprRevision] = []
active_collaboration: ContextVar[CollaborationSession | None] = ContextVar(
    "active_collaboration", default=None
)
active_identity: ContextVar[CollaborationIdentity | None] = ContextVar(
    "active_identity", default=None
)


@dataclass
class _RateLimitBucket:
    started_at: float
    count: int = 0


_rate_limit_buckets: dict[str, _RateLimitBucket] = {}
_rate_limit_lock = asyncio.Lock()


def _identity_token(identity: CollaborationIdentity) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps(
            {"id": identity.id, "displayName": identity.display_name},
            separators=(",", ":"),
        ).encode("utf-8")
    ).decode("ascii").rstrip("=")
    signature = hmac.new(
        SESSION_SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256
    ).hexdigest()
    return f"{payload}.{signature}"


def _identity_from_token(token: str | None) -> CollaborationIdentity | None:
    if not token or "." not in token:
        return None
    payload, signature = token.rsplit(".", 1)
    expected = hmac.new(
        SESSION_SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        padded = payload + "=" * (-len(payload) % 4)
        raw = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        identity_id = raw["id"]
        display_name = raw["displayName"]
        if (
            not isinstance(identity_id, str)
            or not identity_id
            or not isinstance(display_name, str)
        ):
            return None
        return CollaborationIdentity(identity_id, display_name[:80])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


def request_identity(request: Request) -> CollaborationIdentity | None:
    authorization = request.headers.get("authorization", "")
    bearer = authorization.removeprefix("Bearer ").strip()
    return _identity_from_token(bearer) or _identity_from_token(
        request.cookies.get(IDENTITY_COOKIE)
    )


def _identity_from_websocket(websocket: WebSocket) -> CollaborationIdentity | None:
    authorization = websocket.headers.get("authorization", "")
    bearer = authorization.removeprefix("Bearer ").strip()
    return _identity_from_token(bearer) or _identity_from_token(
        websocket.cookies.get(IDENTITY_COOKIE)
    )


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    client_host = request.client.host if request.client else "unknown"
    return (forwarded.split(",")[0].strip() if forwarded else client_host) or "unknown"


async def _allow_request(key: str, limit: int, window_seconds: float) -> bool:
    now = asyncio.get_running_loop().time()
    async with _rate_limit_lock:
        bucket = _rate_limit_buckets.get(key)
        if bucket is None or now - bucket.started_at >= window_seconds:
            _rate_limit_buckets[key] = _RateLimitBucket(now, 1)
            return True
        if bucket.count >= limit:
            return False
        bucket.count += 1
        return True


def _unauthorized(message: str = "An authenticated identity is required") -> JSONResponse:
    return JSONResponse(status_code=401, content={"detail": {"error": message}})


class CollaborationCreateResponse(BaseModel):
    session_id: str
    code: str
    owner_token: str
    member_token: str
    role: Literal["owner", "editor", "viewer"]
    expires_at: str


class CollaborationJoinRequest(BaseModel):
    session_id: str = Field(min_length=1)
    code: str = Field(min_length=6, max_length=6)


class CollaborationJoinResponse(BaseModel):
    session_id: str
    expires_at: str
    revision: int
    participant_count: int
    model: PprModel
    member_token: str
    role: Literal["owner", "editor", "viewer"]


class CollaborationCloseRequest(BaseModel):
    owner_token: str | None = Field(default=None, min_length=1)


class ModelRevisionSummary(BaseModel):
    id: str
    revision: int
    created_at: str
    created_by: str
    summary: str
    model_name: str
    element_count: int
    relationship_count: int
    is_current: bool


class ModelRevisionDetail(ModelRevisionSummary):
    model: PprModel


class ElementInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    type: Literal["product", "process", "resource"]
    definition_id: str | None = None
    description: str = ""
    x: float = 100
    y: float = 100
    attributes: list[Attribute] = Field(default_factory=list)
    visible_in_ppr: bool = True
    state: str | None = None


class ElementUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1)
    definition_id: str | None = None
    description: str | None = None
    x: float | None = None
    y: float | None = None
    attributes: list[Attribute] | None = None
    visible_in_ppr: bool | None = None
    state: str | None = None


class DefinitionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    type: Literal["product", "process", "resource"]
    domain: str | None = Field(default=None, max_length=80)
    parent_definition_id: str | None = None
    description: str = ""
    attributes: list[Attribute] = Field(default_factory=list)
    states: list[str] | None = None

    @field_validator("domain", "parent_definition_id")
    @classmethod
    def optional_definition_context_is_trimmed(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class DefinitionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1)
    domain: str | None = Field(default=None, max_length=80)
    parent_definition_id: str | None = None
    description: str | None = None
    attributes: list[Attribute] | None = None
    states: list[str] | None = None

    @field_validator("domain", "parent_definition_id")
    @classmethod
    def optional_definition_context_is_trimmed(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class RelationshipInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    target_id: str
    kind: RelationshipInputKind
    role_name: str | None = None
    quantity: float | None = Field(default=None, ge=0)
    unit: str | None = None
    lower_bound: int | None = Field(default=None, ge=0)
    upper_bound: int | Literal["*"] | None = None
    modality: RelationshipModality | None = None
    byproduct: bool | None = None
    per: RelationshipRateBasis | None = None
    join: RelationshipJoin | None = None
    min_offset: float | None = None
    max_offset: float | None = None
    offset_unit: str | None = None

    @field_validator("quantity")
    @classmethod
    def quantity_is_finite(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("Quantity must be a finite number.")
        return value

    @field_validator("role_name", "unit", "offset_unit")
    @classmethod
    def unit_is_trimmed(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class RelationshipUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_name: str | None = None
    quantity: float | None = Field(default=None, ge=0)
    unit: str | None = None
    lower_bound: int | None = Field(default=None, ge=0)
    upper_bound: int | Literal["*"] | None = None
    modality: RelationshipModality | None = None
    byproduct: bool | None = None
    per: RelationshipRateBasis | None = None
    join: RelationshipJoin | None = None
    min_offset: float | None = None
    max_offset: float | None = None
    offset_unit: str | None = None

    @field_validator("quantity")
    @classmethod
    def quantity_is_finite(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("Quantity must be a finite number.")
        return value

    @field_validator("role_name", "unit", "offset_unit")
    @classmethod
    def unit_is_trimmed(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


RELATIONSHIP_QUALIFIERS = {
    "role_name",
    "quantity",
    "unit",
    "lower_bound",
    "upper_bound",
    "modality",
    "byproduct",
    "per",
    "join",
    "min_offset",
    "max_offset",
    "offset_unit",
}
VALID_RELATIONSHIP_QUALIFIERS: dict[RelationKind, set[str]] = {
    "consumed_by": {"role_name", "quantity", "unit", "lower_bound", "upper_bound", "per"},
    "produces": {"role_name", "quantity", "unit", "lower_bound", "upper_bound", "per", "byproduct"},
    "performs": {"modality"},
    "contains": set(),
    "succeeds": {"join", "min_offset", "max_offset", "offset_unit"},
    "becomes": set(),
}


def reject_invalid_sent_qualifiers(
    payload: RelationshipInput | RelationshipUpdate,
    kind: RelationKind,
) -> None:
    invalid = (
        payload.model_fields_set & RELATIONSHIP_QUALIFIERS
    ) - VALID_RELATIONSHIP_QUALIFIERS[kind]
    if not invalid:
        return
    code = "IDENT-4" if kind == "becomes" else "RELATIONSHIP-QUALIFIER"
    message = (
        "becomes carries no quantity, unit, role_name or bounds"
        if kind == "becomes"
        else f"Qualifier(s) {', '.join(sorted(invalid))} are not valid on '{kind}'."
    )
    raise HTTPException(
        status_code=422,
        detail={
            "error": "Relationship is not valid",
            "issues": [
                {
                    "code": code,
                    "severity": "error",
                    "message": message,
                    "element_id": None,
                    "relationship_id": None,
                }
            ],
        },
    )


class ModelMetadataUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1)
    description: str | None = None


class ModelCheckpointRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(default="Agent checkpoint", min_length=1, max_length=200)


def persist(model: PprModel) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(model.model_dump_json(indent=2), encoding="utf-8")


def revision_data_path() -> Path:
    return DATA_PATH.with_name(f"{DATA_PATH.stem}.revisions.json")


def persist_revision_history(history: list[PprRevision]) -> None:
    history = retain_ppr_revisions(history)
    path = revision_data_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "[\n"
        + ",\n".join(revision.model_dump_json(indent=2) for revision in history)
        + "\n]\n",
        encoding="utf-8",
    )


def load_revision_history() -> list[PprRevision]:
    global revision_history_cache_path, revision_history
    path = revision_data_path()
    if revision_history_cache_path != path:
        revision_history_cache_path = path
        revision_history = []
        if path.exists():
            try:
                raw_history = json.loads(path.read_text(encoding="utf-8"))
                loaded_history = [
                    PprRevision.model_validate(item) for item in raw_history
                ]
                revision_history = retain_ppr_revisions(loaded_history)
                if len(revision_history) != len(loaded_history):
                    persist_revision_history(revision_history)
            except (OSError, ValueError, ValidationError):
                revision_history = []
    if not revision_history:
        revision_history = [
            make_ppr_revision(
                current_model,
                revision=0,
                summary="Initial model snapshot",
            )
        ]
    return revision_history


def persist_model_and_revisions(
    model: PprModel, history: list[PprRevision]
) -> None:
    """Write the model and its history beside each other before committing memory."""

    history = retain_ppr_revisions(history)
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    model_temp = DATA_PATH.with_name(f".{DATA_PATH.name}.tmp")
    revisions_path = revision_data_path()
    revisions_temp = revisions_path.with_name(f".{revisions_path.name}.tmp")
    try:
        model_temp.write_text(model.model_dump_json(indent=2), encoding="utf-8")
        revisions_temp.write_text(
            "[\n"
            + ",\n".join(revision.model_dump_json(indent=2) for revision in history)
            + "\n]\n",
            encoding="utf-8",
        )
        os.replace(model_temp, DATA_PATH)
        os.replace(revisions_temp, revisions_path)
    finally:
        model_temp.unlink(missing_ok=True)
        revisions_temp.unlink(missing_ok=True)


def read_persisted() -> PprModel | None:
    if not DATA_PATH.exists():
        return None
    try:
        return PprModel.model_validate_json(DATA_PATH.read_text(encoding="utf-8"))
    except (OSError, ValidationError):
        return None


restored = read_persisted()
if restored:
    current_model = restored


@app.middleware("http")
async def select_collaboration_session(request: Request, call_next):
    if request.url.path.startswith("/api/collaboration/"):
        if not await _allow_request(f"collab:{_client_key(request)}", 120, 60):
            return JSONResponse(
                status_code=429,
                content={"detail": {"error": "Too many collaboration requests; try again shortly"}},
                headers={"Retry-After": "60"},
            )
    session_id = request.headers.get("x-collaboration-session")
    code = request.headers.get("x-collaboration-code")
    member_token = request.headers.get("x-collaboration-token")
    session: CollaborationSession | None = None
    identity = request_identity(request)
    if session_id or code:
        if not identity:
            return _unauthorized()
        if not session_id:
            return _unauthorized("A collaboration session is required")
        try:
            if member_token:
                session, membership = collaboration_manager.authorize_member(
                    session_id, identity.id, member_token
                )
            elif code:
                session = collaboration_manager.authorize(session_id, code)
                if session.owner_identity_id != identity.id:
                    raise CollaborationAuthorizationError(
                        "A session membership token is required"
                    )
                membership = next(
                    membership
                    for membership in session.memberships.values()
                    if membership.identity_id == identity.id
                    and membership.role == "owner"
                )
            else:
                raise CollaborationAuthorizationError(
                    "A collaboration membership token is required"
                )
            if request.method in {"POST", "PUT", "PATCH", "DELETE"} and membership.role == "viewer":
                raise CollaborationAuthorizationError(
                    "Viewer memberships cannot modify the model"
                )
        except (CollaborationError, StopIteration) as error:
            return JSONResponse(
                content={"detail": {"error": str(error)}},
                status_code=403 if isinstance(error, CollaborationAuthorizationError) else 401,
            )
    token = active_collaboration.set(session)
    identity_token = active_identity.set(identity)
    try:
        return await call_next(request)
    finally:
        active_collaboration.reset(token)
        active_identity.reset(identity_token)


def active_model() -> PprModel:
    session = active_collaboration.get()
    return session.model if session else current_model


def revision_author() -> str:
    return (
        "Collaborative editor"
        if active_collaboration.get() is not None
        else "Workspace user"
    )


def revision_summaries(
    history: list[PprRevision],
    model: PprModel,
) -> list[ModelRevisionSummary]:
    has_unsaved_changes = not history or model != history[-1].model
    return [
        ModelRevisionSummary(
            id=revision.id,
            revision=revision.revision,
            created_at=revision.created_at.isoformat(),
            created_by=revision.created_by,
            summary=revision.summary,
            model_name=revision.model.name,
            element_count=len(revision.model.diagram.usages),
            relationship_count=len(revision.model.diagram.relationships),
            is_current=index == 0 and not has_unsaved_changes,
        )
        for index, revision in enumerate(reversed(history))
    ]


def replace_active_model(
    model: PprModel,
    *,
    summary: str = "Saved model snapshot",
    created_by: str | None = None,
    checkpoint: bool = False,
) -> PprModel:
    result = validate_ppr_model(model)
    if not result.valid:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Model validation failed",
                "issues": result.model_dump()["issues"],
            },
        )
    session = active_collaboration.get()
    if session:
        if checkpoint:
            collaboration_manager.save_model(
                session,
                model,
                summary=summary,
                created_by=created_by or revision_author(),
            )
        else:
            collaboration_manager.replace_model(session, model)
    else:
        global current_model
        existing_history = load_revision_history()
        history = existing_history
        if checkpoint and (not history or model != history[-1].model):
            next_revision = history[-1].revision + 1
            history = retain_ppr_revisions(
                [
                    *history,
                    make_ppr_revision(
                        model,
                        revision=next_revision,
                        summary=summary,
                        created_by=created_by or revision_author(),
                    ),
                ]
            )
        persist_model_and_revisions(model, history)
        revision_history[:] = history
        current_model = model.model_copy(deep=True)
    return model


async def broadcast_active_model_update(participant_id: str = "model-api") -> None:
    session = active_collaboration.get()
    if session:
        await collaboration_manager.broadcast(
            session,
            {
                "type": "model.updated",
                "revision": session.revision,
                "participantId": participant_id,
                "model": session.model.model_dump(mode="json"),
            },
        )


async def replace_active_model_and_broadcast(
    model: PprModel,
    *,
    summary: str = "Saved model snapshot",
    created_by: str | None = None,
    checkpoint: bool = False,
    participant_id: str = "model-api",
) -> PprModel:
    result = replace_active_model(
        model,
        summary=summary,
        created_by=created_by,
        checkpoint=checkpoint,
    )
    await broadcast_active_model_update(participant_id)
    return result


def active_revision_history() -> list[PprRevision]:
    session = active_collaboration.get()
    return session.revisions if session else load_revision_history()


@app.get("/api/healthz")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/auth/session")
async def get_authenticated_identity(request: Request, response: Response) -> dict[str, str]:
    identity = request_identity(request)
    if identity is None:
        identity = CollaborationIdentity(
            id=f"user_{secrets.token_urlsafe(16)}",
            display_name="Authenticated engineer",
        )
        response.set_cookie(
            IDENTITY_COOKIE,
            _identity_token(identity),
            httponly=True,
            secure=request.url.scheme == "https",
            samesite="strict",
            max_age=60 * 60 * 24 * 30,
            path="/",
        )
    return {"id": identity.id, "display_name": identity.display_name}


@app.post("/api/collaboration/sessions", response_model=CollaborationCreateResponse)
async def create_collaboration_session(
    request: Request, response: Response
) -> CollaborationCreateResponse:
    identity = request_identity(request)
    if not identity:
        raise HTTPException(status_code=401, detail={"error": "An authenticated identity is required"})
    session = collaboration_manager.create(active_model(), identity.id)
    response.set_cookie(
        membership_cookie_name(session.id),
        session.owner_token,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        max_age=int(MEMBERSHIP_TTL.total_seconds()),
        path="/",
    )
    return CollaborationCreateResponse(
        session_id=session.id,
        code=session.code,
        owner_token=session.owner_token,
        member_token=session.owner_token,
        role="owner",
        expires_at=session.expires_at.isoformat(),
    )


@app.post("/api/collaboration/join", response_model=CollaborationJoinResponse)
def join_collaboration_session(
    payload: CollaborationJoinRequest, request: Request, response: Response
) -> CollaborationJoinResponse:
    identity = request_identity(request)
    if not identity:
        raise HTTPException(status_code=401, detail={"error": "An authenticated identity is required"})
    try:
        session, member_token, role = collaboration_manager.join(
            payload.session_id, payload.code, identity.id
        )
    except CollaborationError as error:
        raise HTTPException(status_code=404, detail={"error": str(error)}) from error
    response.set_cookie(
        membership_cookie_name(session.id),
        member_token,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        max_age=int(MEMBERSHIP_TTL.total_seconds()),
        path="/",
    )
    return CollaborationJoinResponse(
        session_id=session.id,
        expires_at=session.expires_at.isoformat(),
        revision=session.revision,
        participant_count=len(session.participants),
        model=session.model,
        member_token=member_token,
        role=role,
    )


@app.post("/api/collaboration/sessions/{session_id}/close", status_code=204)
async def close_collaboration_session(
    session_id: str, payload: CollaborationCloseRequest, request: Request
) -> Response:
    identity = request_identity(request)
    token = request.headers.get("x-collaboration-token") or payload.owner_token
    if not identity or not token:
        raise HTTPException(status_code=401, detail={"error": "An authenticated session owner is required"})
    try:
        session = collaboration_manager.close(session_id, token, identity.id)
    except CollaborationError as error:
        raise HTTPException(status_code=403, detail={"error": str(error)}) from error
    await collaboration_manager.broadcast(session, {"type": "session.closed"})
    for participant in list(session.participants.values()):
        await participant.websocket.close(code=1000, reason="Session closed by owner")
    return Response(status_code=204)


@app.websocket("/api/collaboration/ws/{session_id}")
async def collaboration_websocket(
    websocket: WebSocket, session_id: str, name: str = "Guest"
) -> None:
    origin = websocket.headers.get("origin")
    if not websocket_origin_allowed(
        origin,
        websocket.headers.get("host"),
        websocket.headers.get("x-forwarded-host"),
    ):
        await websocket.close(code=1008, reason="Origin is not allowed")
        return
    identity = _identity_from_websocket(websocket)
    subprotocols = websocket.scope.get("subprotocols", [])
    supplied_member_token = (
        subprotocols[1]
        if len(subprotocols) >= 2 and subprotocols[0] == "ppr-collaboration-v1"
        else None
    )
    member_token = supplied_member_token or websocket.cookies.get(
        membership_cookie_name(session_id)
    )
    code = websocket.query_params.get("code")
    membership = None
    try:
        if not identity:
            raise CollaborationAuthorizationError(
                "An authenticated identity is required"
            )
        if member_token:
            session, membership = collaboration_manager.authorize_member(
                session_id, identity.id, member_token
            )
        elif code:
            # Compatibility for older owner clients: an invite code can only
            # authenticate the identity that created the session.
            session = collaboration_manager.authorize(session_id, code)
            if session.owner_identity_id != identity.id:
                raise CollaborationAuthorizationError(
                    "A collaboration membership token is required"
                )
            membership = next(
                membership
                for membership in session.memberships.values()
                if membership.identity_id == identity.id
                and membership.role == "owner"
            )
        else:
            raise CollaborationAuthorizationError(
                "A collaboration membership token is required"
            )
    except (CollaborationError, StopIteration) as error:
        # Accept before closing so browsers receive the actionable WebSocket
        # close code/reason instead of reducing the failed handshake to an
        # opaque network error (which the Vite runtime overlay treats as a
        # crashed application).
        await websocket.accept()
        await websocket.close(code=1008, reason=str(error))
        return
    await websocket.accept(
        subprotocol="ppr-collaboration-v1" if supplied_member_token else None
    )
    participant_id = new_id("participant")
    participant = Participant(
        id=participant_id,
        name=name.strip()[:80] or "Guest",
        websocket=websocket,
        identity_id=identity.id,
        role=membership.role if membership else "owner",
        color=collaboration_manager.next_participant_color(session),
    )
    session.participants[participant_id] = participant
    await websocket.send_json(
        {
            "type": "session.ready",
            "participantId": participant_id,
            "revision": session.revision,
            "model": session.model.model_dump(mode="json"),
            "participants": collaboration_manager.presence(session),
        }
    )
    await collaboration_manager.broadcast(
        session,
        {
            "type": "presence.updated",
            "participants": collaboration_manager.presence(session),
        },
        exclude=participant_id,
    )
    try:
        while True:
            if (
                session.revoked_at is not None
                or session.expires_at <= datetime.now(UTC)
                or membership.expires_at <= datetime.now(UTC)
            ):
                await websocket.send_json(
                    {"type": "session.expired", "message": "The collaboration session has expired"}
                )
                await websocket.close(code=4001, reason="Collaboration session expired")
                break
            try:
                message = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=PARTICIPANT_IDLE_TIMEOUT.total_seconds(),
                )
            except asyncio.TimeoutError:
                try:
                    await websocket.send_json({"type": "ping"})
                    await asyncio.wait_for(
                        websocket.receive_json(),
                        timeout=10,
                    )
                    participant.last_seen_at = datetime.now(UTC)
                except asyncio.TimeoutError as error:
                    raise WebSocketDisconnect() from error
                if (
                    session.revoked_at is not None
                    or session.expires_at <= datetime.now(UTC)
                    or membership.expires_at <= datetime.now(UTC)
                ):
                    await websocket.send_json(
                        {"type": "session.expired", "message": "The collaboration session has expired"}
                    )
                    await websocket.close(code=4001, reason="Collaboration session expired")
                    break
                continue
            participant.last_seen_at = datetime.now(UTC)
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if message.get("type") == "pong":
                continue
            if message.get("type") in {"cursor.move", "cursor.clear"}:
                cursor: CursorPosition | None = None
                if message.get("type") == "cursor.move":
                    raw_cursor = message.get("cursor")
                    if not isinstance(raw_cursor, dict):
                        await websocket.send_json({"type": "error", "message": "A cursor position is required"})
                        continue
                    try:
                        x = float(raw_cursor["x"])
                        y = float(raw_cursor["y"])
                    except (KeyError, TypeError, ValueError):
                        await websocket.send_json({"type": "error", "message": "Cursor coordinates must be numbers"})
                        continue
                    if not math.isfinite(x) or not math.isfinite(y):
                        await websocket.send_json({"type": "error", "message": "Cursor coordinates must be finite"})
                        continue
                    cursor = {"x": x, "y": y}
                collaboration_manager.set_cursor(participant, cursor)
                await collaboration_manager.broadcast(
                    session,
                    {
                        "type": "cursor.updated",
                        "participantId": participant_id,
                        "cursor": cursor,
                    },
                    exclude=participant_id,
                )
                continue
            if message.get("type") == "surface.update":
                raw_surface = message.get("surface")
                if raw_surface is not None and (
                    not isinstance(raw_surface, str) or raw_surface not in WORKSPACE_SURFACES
                ):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Workspace surface must be one of library, graph, levels, item, process, product, or resource",
                        }
                    )
                    continue
                surface = cast(WorkspaceSurface | None, raw_surface)
                collaboration_manager.set_surface(participant, surface)
                await collaboration_manager.broadcast(
                    session,
                    {
                        "type": "surface.updated",
                        "participantId": participant_id,
                        "surface": surface,
                    },
                    exclude=participant_id,
                )
                continue
            if message.get("type") == "selection.update":
                raw_selection = message.get("selection")
                if not isinstance(raw_selection, list) or any(
                    not isinstance(element_id, str) for element_id in raw_selection
                ):
                    await websocket.send_json(
                        {"type": "error", "message": "Selection must be a list of asset IDs"}
                    )
                    continue
                valid_ids = {element.id for element in session.model.diagram.usages}
                selection = list(dict.fromkeys(
                    element_id for element_id in raw_selection if element_id in valid_ids
                ))[:100]
                collaboration_manager.set_selection(participant, selection)
                await collaboration_manager.broadcast(
                    session,
                    {
                        "type": "selection.updated",
                        "participantId": participant_id,
                        "selection": selection,
                    },
                    exclude=participant_id,
                )
                continue
            if message.get("type") != "model.update":
                await websocket.send_json(
                    {"type": "error", "message": "Unsupported collaboration message"}
                )
                continue
            if membership.role == "viewer":
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": "Viewer memberships cannot modify the model",
                    }
                )
                continue
            client_update_id = message.get("clientUpdateId")
            try:
                model = PprModel.model_validate(message.get("model"))
                base_revision = message.get("baseRevision")
                if client_update_id is not None and (
                    not isinstance(client_update_id, str) or not client_update_id.strip()
                ):
                    await websocket.send_json(
                        {"type": "error", "message": "A client update ID must be a non-empty string"}
                    )
                    continue
                if isinstance(client_update_id, str):
                    client_update_id = client_update_id.strip()
                    applied_update = session.applied_updates.get(client_update_id)
                    if applied_update is not None:
                        applied_revision, applied_model = applied_update
                        if applied_model != model:
                            await websocket.send_json(
                                {
                                    "type": "error",
                                    "message": "A client update ID cannot be reused for a different model",
                                    "clientUpdateId": client_update_id,
                                }
                            )
                            continue
                        if model == session.model:
                            await websocket.send_json(
                                {
                                    "type": "model.ack",
                                    "revision": session.revision,
                                    "clientUpdateId": client_update_id,
                                }
                            )
                        else:
                            await websocket.send_json(
                                {
                                    "type": "model.conflict",
                                    "message": "A newer model revision is already available",
                                    "revision": session.revision,
                                    "model": session.model.model_dump(mode="json"),
                                    "clientUpdateId": client_update_id,
                                }
                            )
                        continue
                if base_revision != session.revision:
                    if model == session.model:
                        acknowledgement = {
                            "type": "model.ack",
                            "revision": session.revision,
                        }
                        if client_update_id:
                            acknowledgement["clientUpdateId"] = client_update_id
                        await websocket.send_json(acknowledgement)
                        if not client_update_id:
                            await collaboration_manager.broadcast(
                                session,
                                {
                                    "type": "model.updated",
                                    "revision": session.revision,
                                    "participantId": participant_id,
                                    "model": session.model.model_dump(mode="json"),
                                },
                                exclude=participant_id,
                            )
                    else:
                        conflict = {
                            "type": "model.conflict",
                            "message": "A newer model revision is already available",
                            "revision": session.revision,
                            "model": session.model.model_dump(mode="json"),
                        }
                        if client_update_id:
                            conflict["clientUpdateId"] = client_update_id
                        await websocket.send_json(conflict)
                    continue
                transport_revision = collaboration_manager.replace_model(session, model)
                if client_update_id:
                    session.applied_updates[client_update_id] = (
                        transport_revision,
                        session.model.model_copy(deep=True),
                    )
                    while len(session.applied_updates) > MAX_APPLIED_COLLABORATION_UPDATES:
                        session.applied_updates.pop(next(iter(session.applied_updates)))
            except (ValidationError, CollaborationError) as error:
                error_payload = {"type": "error", "message": str(error)}
                if client_update_id:
                    error_payload["clientUpdateId"] = client_update_id
                await websocket.send_json(error_payload)
                continue
            acknowledgement = {"type": "model.ack", "revision": session.revision}
            if client_update_id:
                acknowledgement["clientUpdateId"] = client_update_id
            await websocket.send_json(acknowledgement)
            await collaboration_manager.broadcast(
                session,
                {
                    "type": "model.updated",
                    "revision": session.revision,
                    "participantId": participant_id,
                    "model": session.model.model_dump(mode="json"),
                },
                exclude=participant_id,
            )
    except WebSocketDisconnect:
        pass
    finally:
        session.participants.pop(participant_id, None)
        await collaboration_manager.broadcast(
            session,
            {
                "type": "presence.updated",
                "participants": collaboration_manager.presence(session),
            },
        )


@app.get("/api/model", response_model=PprModel)
def get_model() -> PprModel:
    return active_model()


@app.patch("/api/model", response_model=PprModel)
async def update_model_metadata(payload: ModelMetadataUpdate) -> PprModel:
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(
            status_code=422,
            detail={"error": "Provide a model name or description to update."},
        )
    candidate = active_model().model_copy(update=values, deep=True)
    return await replace_active_model_and_broadcast(
        candidate,
        summary="Updated model metadata",
    )


@app.get("/api/model/relationship-rules")
def get_relationship_rules() -> dict[str, list[dict[str, str]]]:
    return RELATIONSHIP_RULES


@app.get("/api/model/revisions", response_model=list[ModelRevisionSummary])
def list_model_revisions() -> list[ModelRevisionSummary]:
    return revision_summaries(active_revision_history(), active_model())


@app.post("/api/model/revisions", response_model=ModelRevisionSummary)
async def create_model_checkpoint(
    payload: ModelCheckpointRequest = Body(default=ModelCheckpointRequest()),
) -> ModelRevisionSummary:
    replace_active_model(
        active_model(),
        summary=payload.summary,
        checkpoint=True,
    )
    return revision_summaries(active_revision_history(), active_model())[0]


@app.get("/api/model/revisions/{revision_id}", response_model=ModelRevisionDetail)
def get_model_revision(revision_id: str) -> ModelRevisionDetail:
    revision = next(
        (item for item in active_revision_history() if item.id == revision_id),
        None,
    )
    if revision is None:
        raise HTTPException(status_code=404, detail={"error": "Revision not found"})
    return ModelRevisionDetail(
        id=revision.id,
        revision=revision.revision,
        created_at=revision.created_at.isoformat(),
        created_by=revision.created_by,
        summary=revision.summary,
        model_name=revision.model.name,
        element_count=len(revision.model.diagram.usages),
        relationship_count=len(revision.model.diagram.relationships),
        is_current=(
            revision.id == active_revision_history()[-1].id
            and revision.model == active_model()
        ),
        model=revision.model,
    )


@app.post("/api/model/revisions/{revision_id}/restore", response_model=PprModel)
async def restore_model_revision(revision_id: str) -> PprModel:
    history = active_revision_history()
    revision = next((item for item in history if item.id == revision_id), None)
    if revision is None:
        raise HTTPException(status_code=404, detail={"error": "Revision not found"})

    restored = replace_active_model(
        revision.model,
        summary=f"Restored revision {revision.revision}",
        created_by=revision_author(),
        checkpoint=True,
    )
    await broadcast_active_model_update("revision-history")
    return restored


@app.put("/api/model", response_model=PprModel)
async def save_model(
    model: PprModel,
    checkpoint: bool = Query(
        default=True,
        description="Create a saved revision when the model differs from the latest checkpoint.",
    ),
) -> PprModel:
    required_fields = {"id", "name", "description", "library", "diagram"}
    missing_fields = sorted(required_fields - model.model_fields_set)
    if missing_fields:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "PUT /api/model requires a complete model document.",
                "missing_fields": missing_fields,
            },
        )
    saved = replace_active_model(
        model,
        summary="Saved model snapshot",
        checkpoint=checkpoint,
    )
    await broadcast_active_model_update()
    return saved


@app.post("/api/model/example", response_model=PprModel)
async def load_example_model() -> PprModel:
    return await replace_active_model_and_broadcast(
        example_model(),
        summary="Loaded built-in example model",
        checkpoint=True,
    )


@app.post("/api/model/reset", response_model=PprModel)
async def reset_model() -> PprModel:
    return await replace_active_model_and_broadcast(
        PprModel(),
        summary="Reset to an empty model",
        checkpoint=True,
    )


@app.post("/api/model/import/sysml", response_model=PprModel)
async def import_sysml_model(content: str = Body(..., media_type="text/plain")) -> PprModel:
    """Parse a portable or PPR-profiled SysML v2 document and persist it."""
    try:
        imported = import_sysml(content)
    except SysmlImportError as error:
        raise HTTPException(status_code=422, detail={"error": str(error)}) from error
    return await replace_active_model_and_broadcast(
        imported,
        summary="Imported SysML model",
        checkpoint=True,
    )


@app.post("/api/model/import/automationml", response_model=PprModel)
async def import_automationml_model(
    content: str = Body(..., media_type="application/xml"),
) -> PprModel:
    """Parse the PPR AutomationML profile and persist it."""
    try:
        imported = import_automationml(content)
    except AutomationMlImportError as error:
        raise HTTPException(status_code=422, detail={"error": str(error)}) from error
    return await replace_active_model_and_broadcast(
        imported,
        summary="Imported AutomationML model",
        checkpoint=True,
    )


@app.post("/api/model/validate", response_model=ValidationResult)
def validate_model(model: PprModel) -> ValidationResult:
    return validate_ppr_model(model)


@app.get("/api/model/items", response_model=list[PprItem])
def get_items() -> list[PprItem]:
    return derive_ppr_items(active_model())


@app.post("/api/model/items/infer", response_model=IdentityInferenceResult)
async def infer_items(
    payload: IdentityInferenceRequest = Body(default=IdentityInferenceRequest()),
) -> IdentityInferenceResult:
    model = active_model()
    result = infer_identity(model)
    if not payload.apply or not result.proposals:
        return result
    candidate = model.model_copy(deep=True)
    for proposal in result.proposals:
        candidate.diagram.relationships.append(
            PprRelationship(
                id=new_id("rel"),
                source_id=proposal.source_id,
                target_id=proposal.target_id,
                kind="becomes",
            )
        )
    await replace_active_model_and_broadcast(
        candidate,
        summary="Inferred product identity chains",
    )
    return result


@app.post("/api/model/elements", response_model=PprElement, status_code=201)
async def create_element(payload: ElementInput) -> PprElement:
    model = active_model()
    definition = (
        next(
            (
                item
                for item in model.library.definitions
                if item.id == payload.definition_id
            ),
            None,
        )
        if payload.definition_id is not None
        else None
    )
    if payload.definition_id is not None and (
        not definition or definition.type != payload.type
    ):
        raise HTTPException(
            status_code=422,
            detail={
                "error": "A usage must reference an existing definition of the same type."
            },
        )
    try:
        element = PprElement(
            id=new_id(payload.type), kind="usage", **payload.model_dump()
        )
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Diagram usage is not valid",
                "issues": error.errors(include_context=False),
            },
        ) from error
    candidate = model.model_copy(deep=True)
    candidate.diagram.usages.append(element)
    await replace_active_model_and_broadcast(
        candidate,
        summary=f"Added {payload.type} usage",
    )
    return element


@app.get("/api/model/elements/{element_id}", response_model=PprElement)
def get_element(element_id: str) -> PprElement:
    element = next(
        (item for item in active_model().diagram.usages if item.id == element_id),
        None,
    )
    if element is None:
        raise HTTPException(
            status_code=404, detail={"error": "Diagram usage not found"}
        )
    return element


@app.patch("/api/model/elements/{element_id}", response_model=PprElement)
async def update_element(element_id: str, payload: ElementUpdate) -> PprElement:
    model = active_model()
    element = next(
        (item for item in model.diagram.usages if item.id == element_id), None
    )
    if not element:
        raise HTTPException(
            status_code=404, detail={"error": "Diagram usage not found"}
        )
    values = payload.model_dump(exclude_unset=True)
    try:
        candidate = PprElement.model_validate({**element.model_dump(), **values})
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Diagram usage update is not valid",
                "issues": error.errors(include_context=False),
            },
        ) from error
    definition = (
        next(
            (
                item
                for item in model.library.definitions
                if item.id == candidate.definition_id
            ),
            None,
        )
        if candidate.definition_id is not None
        else None
    )
    if candidate.definition_id is not None and (
        not definition or definition.type != candidate.type
    ):
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Usage must reference an existing definition of the same type."
            },
        )
    next_model = model.model_copy(deep=True)
    next_model.diagram.usages[next_model.diagram.usages.index(element)] = candidate
    await replace_active_model_and_broadcast(
        next_model,
        summary=f"Updated {element.type} usage",
    )
    return candidate


@app.delete("/api/model/elements/{element_id}", status_code=204)
async def delete_element(element_id: str) -> Response:
    model = active_model()
    if not any(item.id == element_id for item in model.diagram.usages):
        raise HTTPException(
            status_code=404, detail={"error": "Diagram usage not found"}
        )
    next_model = model.model_copy(deep=True)
    next_model.diagram.usages = [
        item for item in model.diagram.usages if item.id != element_id
    ]
    next_model.diagram.relationships = [
        item
        for item in model.diagram.relationships
        if item.source_id != element_id and item.target_id != element_id
    ]
    await replace_active_model_and_broadcast(
        next_model,
        summary="Removed usage and connected relationships",
    )
    return Response(status_code=204)


@app.post("/api/model/definitions", response_model=PprElement, status_code=201)
async def create_definition(payload: DefinitionInput) -> PprElement:
    model = active_model()
    try:
        definition = PprElement(
            id=new_id(payload.type), kind="definition", **payload.model_dump()
        )
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Library definition is not valid",
                "issues": error.errors(include_context=False),
            },
        ) from error
    next_model = model.model_copy(deep=True)
    next_model.library.definitions.append(definition)
    await replace_active_model_and_broadcast(
        next_model,
        summary=f"Added {payload.type} definition",
    )
    return definition


@app.get("/api/model/definitions/{definition_id}", response_model=PprElement)
def get_definition(definition_id: str) -> PprElement:
    definition = next(
        (
            item
            for item in active_model().library.definitions
            if item.id == definition_id
        ),
        None,
    )
    if definition is None:
        raise HTTPException(
            status_code=404, detail={"error": "Library definition not found"}
        )
    return definition


@app.patch("/api/model/definitions/{definition_id}", response_model=PprElement)
async def update_definition(definition_id: str, payload: DefinitionUpdate) -> PprElement:
    model = active_model()
    definition = next(
        (
            item
            for item in model.library.definitions
            if item.id == definition_id
        ),
        None,
    )
    if not definition:
        raise HTTPException(
            status_code=404, detail={"error": "Library definition not found"}
        )
    try:
        candidate = PprElement.model_validate(
            {**definition.model_dump(), **payload.model_dump(exclude_unset=True)}
        )
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Library definition update is not valid",
                "issues": error.errors(include_context=False),
            },
        ) from error
    next_model = model.model_copy(deep=True)
    next_model.library.definitions[next_model.library.definitions.index(definition)] = candidate
    await replace_active_model_and_broadcast(
        next_model,
        summary=f"Updated {definition.type} definition",
    )
    return candidate


@app.delete("/api/model/definitions/{definition_id}", status_code=204)
async def delete_definition(definition_id: str) -> Response:
    model = active_model()
    if not any(item.id == definition_id for item in model.library.definitions):
        raise HTTPException(
            status_code=404, detail={"error": "Library definition not found"}
        )
    usages = [
        item
        for item in model.diagram.usages
        if item.definition_id == definition_id
    ]
    if usages:
        raise HTTPException(
            status_code=409,
            detail={
                "error": f"Cannot delete definition while {len(usages)} diagram "
                f"{'usage depends' if len(usages) == 1 else 'usages depend'} on it."
            },
        )
    child_definitions = [
        item
        for item in model.library.definitions
        if item.parent_definition_id == definition_id
    ]
    if child_definitions:
        raise HTTPException(
            status_code=409,
            detail={
                "error": f"Cannot delete definition while {len(child_definitions)} child "
                f"{'definition inherits' if len(child_definitions) == 1 else 'definitions inherit'} from it."
            },
        )
    next_model = model.model_copy(deep=True)
    next_model.library.definitions = [
        item for item in model.library.definitions if item.id != definition_id
    ]
    await replace_active_model_and_broadcast(
        next_model,
        summary="Removed library definition",
    )
    return Response(status_code=204)


@app.post("/api/model/relationships", response_model=PprRelationship, status_code=201)
async def create_relationship(
    payload: RelationshipInput, response: Response
) -> PprRelationship:
    model = active_model()
    requested_kind = payload.kind
    canonical_kind = RELATIONSHIP_KIND_ALIASES.get(requested_kind, requested_kind)
    reject_invalid_sent_qualifiers(payload, canonical_kind)
    source = next(
        (item for item in model.diagram.usages if item.id == payload.source_id),
        None,
    )
    target = next(
        (item for item in model.diagram.usages if item.id == payload.target_id),
        None,
    )
    if not source or not target:
        raise HTTPException(
            status_code=422, detail={"error": "Both relationship endpoints must exist."}
        )
    if (source.type, target.type) not in ALLOWED_RELATIONS[canonical_kind]:
        if canonical_kind == "becomes":
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "Relationship is not valid",
                    "issues": [
                        {
                            "code": "IDENT-1",
                            "severity": "error",
                            "message": "becomes endpoints must both be product usages",
                            "element_id": None,
                            "relationship_id": None,
                        }
                    ],
                },
            )
        raise HTTPException(
            status_code=422,
            detail={"error": f"'{canonical_kind}' is not valid for those element types."},
        )
    if any(
        item.source_id == payload.source_id
        and item.target_id == payload.target_id
        and item.kind == canonical_kind
        for item in model.diagram.relationships
    ):
        raise HTTPException(
            status_code=422,
            detail={"error": "That semantic relationship already exists."},
        )
    try:
        values = payload.model_dump()
        values["kind"] = canonical_kind
        if requested_kind == "supports" and payload.modality is None:
            values["modality"] = "supports"
        relationship = PprRelationship(id=new_id("rel"), **values)
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Relationship is not valid",
                "issues": error.errors(include_context=False),
            },
        ) from error
    candidate = model.model_copy(deep=True)
    candidate.diagram.relationships.append(relationship)
    result = validate_ppr_model(candidate)
    if not result.valid:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Relationship is not valid",
                "issues": result.model_dump()["issues"],
            },
        )
    candidate = model.model_copy(deep=True)
    candidate.diagram.relationships.append(relationship)
    await replace_active_model_and_broadcast(
        candidate,
        summary=f"Added {canonical_kind} relationship",
    )
    if requested_kind in RELATIONSHIP_KIND_ALIASES:
        response.headers["Deprecation"] = (
            f"{requested_kind} is deprecated; use {canonical_kind}"
        )
    return relationship


@app.get(
    "/api/model/relationships/{relationship_id}", response_model=PprRelationship
)
def get_relationship(relationship_id: str) -> PprRelationship:
    relationship = next(
        (
            item
            for item in active_model().diagram.relationships
            if item.id == relationship_id
        ),
        None,
    )
    if relationship is None:
        raise HTTPException(status_code=404, detail={"error": "Relationship not found"})
    return relationship


@app.patch("/api/model/relationships/{relationship_id}", response_model=PprRelationship)
async def update_relationship(
    relationship_id: str, payload: RelationshipUpdate
) -> PprRelationship:
    model = active_model()
    relationship = next(
        (
            item
            for item in model.diagram.relationships
            if item.id == relationship_id
        ),
        None,
    )
    if not relationship:
        raise HTTPException(status_code=404, detail={"error": "Relationship not found"})
    values = payload.model_dump(exclude_unset=True)
    reject_invalid_sent_qualifiers(payload, relationship.kind)
    try:
        updated_relationship = PprRelationship.model_validate(
            {**relationship.model_dump(), **values}
        )
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Relationship is not valid",
                "issues": error.errors(include_context=False),
            },
        ) from error
    candidate = model.model_copy(deep=True)
    candidate.diagram.relationships[
        candidate.diagram.relationships.index(relationship)
    ] = updated_relationship
    result = validate_ppr_model(candidate)
    if not result.valid:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Relationship is not valid",
                "issues": result.model_dump()["issues"],
            },
        )
    candidate = model.model_copy(deep=True)
    candidate.diagram.relationships[
        candidate.diagram.relationships.index(relationship)
    ] = updated_relationship
    await replace_active_model_and_broadcast(
        candidate,
        summary=f"Updated {relationship.kind} relationship",
    )
    return updated_relationship


@app.delete("/api/model/relationships/{relationship_id}", status_code=204)
async def delete_relationship(relationship_id: str) -> Response:
    model = active_model()
    before = len(model.diagram.relationships)
    candidate = model.model_copy(deep=True)
    candidate.diagram.relationships = [
        item
        for item in model.diagram.relationships
        if item.id != relationship_id
    ]
    if len(candidate.diagram.relationships) == before:
        raise HTTPException(status_code=404, detail={"error": "Relationship not found"})
    await replace_active_model_and_broadcast(
        candidate,
        summary="Removed relationship",
    )
    return Response(status_code=204)


@app.post("/api/model/merge", response_model=PprModel)
async def merge_model_usages(payload: MergeUsagesRequest) -> PprModel:
    model = active_model()
    try:
        candidate = merge_ppr_usages(model, payload)
    except ValueError as error:
        raise HTTPException(status_code=422, detail={"error": str(error)}) from error

    return await replace_active_model_and_broadcast(
        candidate,
        summary="Merged two usages",
    )


@app.get("/api/model/export/{format}")
def export_model(
    format: Literal["json", "sysml", "sysml-ppr", "automationml"],
) -> dict[str, str]:
    model = active_model()
    if format == "json":
        content = model.model_dump_json(indent=2)
        filename = "ppr-model.json"
    elif format == "sysml":
        try:
            content = export_sysml(model, mode="portable")
        except SysmlExportError as error:
            raise HTTPException(
                status_code=422, detail={"error": str(error)}
            ) from error
        filename = "ppr-model.portable.sysml"
    elif format == "sysml-ppr":
        try:
            content = export_sysml(model, mode="ppr")
        except SysmlExportError as error:
            raise HTTPException(
                status_code=422, detail={"error": str(error)}
            ) from error
        filename = "ppr-model.profile.sysml"
    else:
        try:
            content = export_automationml(model)
        except AutomationMlExportError as error:
            raise HTTPException(
                status_code=422, detail={"error": str(error)}
            ) from error
        filename = "ppr-model.aml"
    return {"format": format, "content": content, "filename": filename}
