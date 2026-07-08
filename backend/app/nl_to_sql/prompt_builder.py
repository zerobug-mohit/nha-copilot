"""Builds the system prompt (CLAUDE.md) and the per-turn user prompt.

CLAUDE.md is loaded once and cached. The `{TMS_TABLE}` / `{BIS_TABLE}`
placeholders are replaced with the fully-qualified, backtick-quoted table refs
from config so the governance doc stays deployment-agnostic.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.config import BACKEND_DIR, get_settings

CLAUDE_MD_PATH = BACKEND_DIR / "CLAUDE.md"


@lru_cache
def _load_claude_md() -> str:
    settings = get_settings()
    text = Path(CLAUDE_MD_PATH).read_text(encoding="utf-8")
    return (
        text.replace("{MERGED_TABLE}", settings.table_ref("merged"))
        .replace("{TMS_TABLE}", settings.table_ref("tms"))
        .replace("{BIS_TABLE}", settings.table_ref("bis"))
    )


def load_system_prompt() -> str:
    """CLAUDE.md (cached) + the live authoritative-types block (appended if the
    schema has been loaded from BigQuery at startup)."""
    from app.db.schema import get_schema_text

    return _load_claude_md() + get_schema_text()


def build_user_prompt(
    question: str,
    role: str,
    session_context: dict | None,
    resolved: dict | None,
) -> str:
    """Assemble the user turn: the question plus all resolved context."""
    parts = [f"USER QUESTION:\n{question}\n"]
    parts.append(f"CALLER ROLE: {role}")
    parts.append(
        "ROLE ACCESS: viewer=national/state aggregates; analyst=+district; "
        "senior_analyst=+hospital (aggregated); admin=all. Generate SQL within "
        "the caller's access level."
    )

    if session_context:
        parts.append(
            "CONFIRMED SESSION CONTEXT (carry forward unless the user changes it):\n"
            + json.dumps(session_context, default=str, indent=2)
        )

    if resolved:
        parts.append(
            "RESOLVED ENTITIES for this question (use these codes/ranges "
            "directly — geography and time have already been parsed for you):\n"
            + json.dumps(resolved, default=str, indent=2)
        )

    parts.append(
        "Respond with the JSON object described in the governance doc "
        '(keys: action, sql, answer_template, message).'
    )
    return "\n\n".join(parts)
