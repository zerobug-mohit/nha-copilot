"""In-memory session store (prototype; no cross-session persistence).

Tracks conversation history and the confirmed geography/period context that
persists across turns until the user changes it.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Session:
    session_id: str
    user_id: str
    role: str
    confirmed_context: dict[str, Any] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def get_or_create(self, session_id: str | None, user_id: str, role: str) -> Session:
        if session_id and session_id in self._sessions:
            return self._sessions[session_id]
        sid = session_id or str(uuid.uuid4())
        session = Session(session_id=sid, user_id=user_id, role=role)
        self._sessions[sid] = session
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def update_context(self, session: Session, resolved: dict) -> None:
        """Persist confirmed geography/period from a successful turn."""
        geos = resolved.get("geography") or []
        if geos:
            g = geos[0]
            session.confirmed_context["state_lgd_code"] = g.get("state_code")
            session.confirmed_context["state_name"] = g.get("state_name") or g.get("name")
        period = resolved.get("period")
        if period:
            session.confirmed_context["period_start"] = period.get("start")
            session.confirmed_context["period_end"] = period.get("end")
            session.confirmed_context["period_label"] = period.get("label")


_store: SessionStore | None = None


def get_session_store() -> SessionStore:
    global _store
    if _store is None:
        _store = SessionStore()
    return _store
