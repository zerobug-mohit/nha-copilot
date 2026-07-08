"""Prototype user store.

Four seed users, one per RBAC role, with bcrypt-hashed passwords. In production
this is replaced by a real identity provider. Passwords default to
`<username>123` and can be overridden via env (not required for the prototype).
"""
from __future__ import annotations

import bcrypt
from dataclasses import dataclass


def _hash(pw: str) -> bytes:
    return bcrypt.hashpw(pw.encode("utf-8")[:72], bcrypt.gensalt())


def _verify(pw: str, hashed: bytes) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8")[:72], hashed)
    except ValueError:
        return False


@dataclass
class User:
    username: str
    password_hash: bytes
    role: str


# Seed users. Default password is "<username>123" (e.g. viewer -> viewer123).
_SEED = [
    ("viewer", "viewer123", "viewer"),
    ("analyst", "analyst123", "analyst"),
    ("senior", "senior123", "senior_analyst"),
    ("admin", "admin123", "admin"),
]

USERS: dict[str, User] = {
    username: User(username, _hash(pw), role) for username, pw, role in _SEED
}


def authenticate(username: str, password: str) -> User | None:
    user = USERS.get(username)
    if user and _verify(password, user.password_hash):
        return user
    return None
