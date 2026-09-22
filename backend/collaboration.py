from __future__ import annotations

import secrets
import hashlib
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from threading import RLock
from typing import Literal, TypedDict

from fastapi import WebSocket, WebSocketDisconnect

from .model.ppr import (
    PprModel,
    PprRevision,
    make_ppr_revision,
    retain_ppr_revisions,
    validate_ppr_model,
)

SESSION_TTL = timedelta(hours=2)
PARTICIPANT_IDLE_TIMEOUT = timedelta(seconds=60)
MEMBERSHIP_TTL = timedelta(hours=2)
MAX_APPLIED_COLLABORATION_UPDATES = 256
COLLABORATION_COLORS = (
    "#2563eb",
    "#c2410c",
    "#15803d",
    "#9333ea",
    "#0f766e",
    "#b45309",
)


class CollaborationError(ValueError):
    pass


class CollaborationAuthorizationError(CollaborationError):
    pass


@dataclass(frozen=True)
class CollaborationIdentity:
    id: str
    display_name: str


@dataclass
class Membership:
    identity_id: str
    role: Literal["owner", "editor", "viewer"]
    token_hash: str
    expires_at: datetime


class CursorPosition(TypedDict):
    x: float
    y: float


WorkspaceSurface = Literal["library", "graph", "levels", "item", "process", "product", "resource"]
WORKSPACE_SURFACES = frozenset({"library", "graph", "levels", "item", "process", "product", "resource"})


@dataclass
class Participant:
    id: str
    name: str
    websocket: WebSocket
    identity_id: str = ""
    role: Literal["owner", "editor", "viewer"] = "editor"
    color: str = COLLABORATION_COLORS[0]
    cursor: CursorPosition | None = None
    surface: WorkspaceSurface | None = None
    selection: list[str] = field(default_factory=list)
    last_seen_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass
class CollaborationSession:
    id: str
    code: str
    code_hash: str
    owner_token: str
    owner_identity_id: str
    model: PprModel
    created_at: datetime
    expires_at: datetime
    revision: int = 0
    revisions: list[PprRevision] = field(default_factory=list)
    participants: dict[str, Participant] = field(default_factory=dict)
    applied_updates: dict[str, tuple[int, PprModel]] = field(default_factory=dict)
    memberships: dict[str, Membership] = field(default_factory=dict)
    revoked_at: datetime | None = None

    def public_payload(self) -> dict[str, object]:
        return {
            "sessionId": self.id,
            "code": self.code,
            "expiresAt": self.expires_at.isoformat(),
            "revision": self.revision,
            "participantCount": len(self.participants),
        }


class CollaborationManager:
    def __init__(self) -> None:
        self._sessions: dict[str, CollaborationSession] = {}
        self._lock = RLock()

    def _cleanup(self) -> None:
        now = datetime.now(UTC)
        expired = [key for key, session in self._sessions.items() if session.expires_at <= now]
        for key in expired:
            self._sessions.pop(key, None)

    @staticmethod
    def _hash_secret(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    @staticmethod
    def _new_membership(
        session: CollaborationSession,
        identity_id: str,
        role: Literal["owner", "editor", "viewer"],
    ) -> str:
        token = secrets.token_urlsafe(32)
        session.memberships[CollaborationManager._hash_secret(token)] = Membership(
            identity_id=identity_id,
            role=role,
            token_hash=CollaborationManager._hash_secret(token),
            expires_at=min(session.expires_at, datetime.now(UTC) + MEMBERSHIP_TTL),
        )
        return token

    def create(
        self,
        model: PprModel,
        identity_id: str = "legacy-owner",
    ) -> CollaborationSession:
        now = datetime.now(UTC)
        with self._lock:
            self._cleanup()
            while True:
                session_id = secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:10]
                if session_id not in self._sessions:
                    break
            code = f"{secrets.randbelow(1_000_000):06d}"
            session = CollaborationSession(
                id=session_id,
                code=code,
                code_hash=self._hash_secret(code),
                owner_token="",
                owner_identity_id=identity_id,
                model=model.model_copy(deep=True),
                created_at=now,
                expires_at=now + SESSION_TTL,
                revisions=[
                    make_ppr_revision(
                        model,
                        revision=0,
                        summary="Collaboration session opened",
                        created_by="Collaboration owner",
                    )
                ],
            )
            session.owner_token = self._new_membership(session, identity_id, "owner")
            self._sessions[session.id] = session
            return session

    def authorize(self, session_id: str, code: str) -> CollaborationSession:
        with self._lock:
            self._cleanup()
            session = self._sessions.get(session_id)
            if (
                not session
                or session.revoked_at is not None
                or not secrets.compare_digest(session.code_hash, self._hash_secret(code))
            ):
                raise CollaborationError("The collaboration session or access code is invalid")
            if session.expires_at <= datetime.now(UTC):
                session.revoked_at = datetime.now(UTC)
                raise CollaborationError("The collaboration session has expired")
            session.expires_at = datetime.now(UTC) + SESSION_TTL
            return session

    def join(
        self,
        session_id: str,
        code: str,
        identity_id: str,
    ) -> tuple[CollaborationSession, str, Literal["owner", "editor", "viewer"]]:
        with self._lock:
            session = self.authorize(session_id, code)
            token = self._new_membership(session, identity_id, "editor")
            return session, token, "editor"

    def authorize_member(
        self,
        session_id: str,
        identity_id: str,
        token: str,
        *,
        required_role: Literal["owner", "editor", "viewer"] = "viewer",
    ) -> tuple[CollaborationSession, Membership]:
        with self._lock:
            self._cleanup()
            session = self._sessions.get(session_id)
            token_hash = self._hash_secret(token)
            membership = session.memberships.get(token_hash) if session else None
            now = datetime.now(UTC)
            role_order = {"viewer": 0, "editor": 1, "owner": 2}
            if (
                not session
                or session.revoked_at is not None
                or membership is None
                or membership.identity_id != identity_id
                or membership.expires_at <= now
                or session.expires_at <= now
                or role_order[membership.role] < role_order[required_role]
            ):
                raise CollaborationAuthorizationError(
                    "Your collaboration membership is invalid or has expired"
                )
            session.expires_at = now + SESSION_TTL
            membership.expires_at = min(session.expires_at, now + MEMBERSHIP_TTL)
            return session, membership

    def authorize_owner(
        self,
        session_id: str,
        identity_id: str,
        token: str,
    ) -> CollaborationSession:
        session, _ = self.authorize_member(
            session_id, identity_id, token, required_role="owner"
        )
        return session

    def close(
        self,
        session_id: str,
        owner_token: str,
        identity_id: str = "legacy-owner",
    ) -> CollaborationSession:
        with self._lock:
            session = self.authorize_owner(session_id, identity_id, owner_token)
            if not session or not secrets.compare_digest(session.owner_token, owner_token):
                raise CollaborationError("Only the session owner can close this session")
            session.revoked_at = datetime.now(UTC)
            return self._sessions.pop(session_id)

    def replace_model(
        self,
        session: CollaborationSession,
        model: PprModel,
    ) -> int:
        """Apply a live model update without creating a saved checkpoint."""

        result = validate_ppr_model(model)
        errors = [issue.message for issue in result.issues if issue.severity == "error"]
        if errors:
            raise CollaborationError("Model validation failed: " + "; ".join(errors))
        with self._lock:
            session.model = model.model_copy(deep=True)
            session.revision += 1
            session.expires_at = datetime.now(UTC) + SESSION_TTL
            return session.revision

    def save_model(
        self,
        session: CollaborationSession,
        model: PprModel,
        *,
        summary: str = "Saved model snapshot",
        created_by: str = "Collaborative editor",
    ) -> PprRevision:
        """Persist a model and add one checkpoint when it differs from the last one."""

        result = validate_ppr_model(model)
        errors = [issue.message for issue in result.issues if issue.severity == "error"]
        if errors:
            raise CollaborationError("Model validation failed: " + "; ".join(errors))
        with self._lock:
            if model != session.model:
                session.revision += 1
            session.model = model.model_copy(deep=True)
            latest_revision = session.revisions[-1] if session.revisions else None
            if latest_revision is not None and latest_revision.model == model:
                session.expires_at = datetime.now(UTC) + SESSION_TTL
                return latest_revision

            next_revision = (latest_revision.revision + 1) if latest_revision else 0
            revision = make_ppr_revision(
                model,
                revision=next_revision,
                summary=summary,
                created_by=created_by,
            )
            session.revisions[:] = retain_ppr_revisions([*session.revisions, revision])
            session.expires_at = datetime.now(UTC) + SESSION_TTL
            return revision

    @staticmethod
    def presence(session: CollaborationSession) -> list[dict[str, object]]:
        now = datetime.now(UTC)
        participants: list[dict[str, object]] = []
        for participant in session.participants.values():
            if now - participant.last_seen_at > PARTICIPANT_IDLE_TIMEOUT:
                continue
            presence: dict[str, object] = {
                "id": participant.id,
                "name": participant.name,
                "color": participant.color,
            }
            if participant.cursor:
                presence["cursor"] = participant.cursor
            if participant.surface:
                presence["surface"] = participant.surface
            if participant.selection:
                presence["selection"] = participant.selection
            participants.append(presence)
        return participants

    @staticmethod
    def next_participant_color(session: CollaborationSession) -> str:
        used_colors = {participant.color for participant in session.participants.values()}
        return next(
            (color for color in COLLABORATION_COLORS if color not in used_colors),
            COLLABORATION_COLORS[len(session.participants) % len(COLLABORATION_COLORS)],
        )

    @staticmethod
    def set_cursor(
        participant: Participant,
        cursor: CursorPosition | None,
    ) -> None:
        participant.cursor = cursor
        participant.last_seen_at = datetime.now(UTC)

    @staticmethod
    def set_surface(
        participant: Participant,
        surface: WorkspaceSurface | None,
    ) -> None:
        participant.surface = surface
        participant.last_seen_at = datetime.now(UTC)

    @staticmethod
    def set_selection(
        participant: Participant,
        selection: list[str],
    ) -> None:
        participant.selection = selection
        participant.last_seen_at = datetime.now(UTC)

    async def broadcast(
        self,
        session: CollaborationSession,
        payload: dict[str, object],
        *,
        exclude: str | None = None,
    ) -> None:
        stale: list[str] = []
        now = datetime.now(UTC)
        for participant_id, participant in list(session.participants.items()):
            if participant_id == exclude:
                continue
            if now - participant.last_seen_at > PARTICIPANT_IDLE_TIMEOUT:
                stale.append(participant_id)
                continue
            try:
                await participant.websocket.send_json(payload)
            except (RuntimeError, WebSocketDisconnect):
                stale.append(participant_id)
        for participant_id in stale:
            session.participants.pop(participant_id, None)


collaboration_manager = CollaborationManager()
