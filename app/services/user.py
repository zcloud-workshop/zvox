import base64
import binascii
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

from psycopg.errors import UniqueViolation

from app.db.database import (
    db_create_session,
    db_create_user,
    db_delete_session,
    db_get_session_user,
    db_get_user,
    db_get_user_by_username,
    db_list_users,
    db_update_password,
    db_update_user,
)

SESSION_TTL = timedelta(hours=24)


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        method, salt_text, digest_text = stored.split("$")
        if method != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_text)
        expected = base64.urlsafe_b64decode(digest_text)
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, binascii.Error):
        return False


def _public_user(row: dict) -> dict:
    return {key: row[key] for key in ("id", "username", "role", "is_active", "created_at")}


_DUMMY_HASH = _hash_password("invalid-password")


def create_user(username: str, password: str, role: str = "user") -> dict:
    username = username.strip().lower()
    if not re.fullmatch(r"[a-z0-9_.-]{3,32}", username):
        raise ValueError("Username must be 3-32 letters, digits, dots, underscores or hyphens")
    if not 8 <= len(password) <= 128:
        raise ValueError("Password must be 8-128 characters")
    if role not in ("admin", "user"):
        raise ValueError("Invalid role")
    try:
        row = db_create_user(username, _hash_password(password), role, datetime.now(timezone.utc).isoformat())
    except UniqueViolation as exc:
        raise ValueError("Username already exists") from exc
    return _public_user(row)


def login(username: str, password: str) -> dict | None:
    row = db_get_user_by_username(username.strip().lower())
    valid_password = _verify_password(password, row["password_hash"] if row else _DUMMY_HASH)
    if not row or not row["is_active"] or not valid_password:
        return None
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + SESSION_TTL).isoformat()
    db_create_session(hashlib.sha256(token.encode()).hexdigest(), row["id"], expires_at)
    return {"access_token": token, "token_type": "bearer", "expires_at": expires_at, "user": _public_user(row)}


def get_user_for_token(token: str) -> dict | None:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    return db_get_session_user(token_hash, datetime.now(timezone.utc).isoformat())


def logout(token: str):
    db_delete_session(hashlib.sha256(token.encode()).hexdigest())


def list_users() -> list[dict]:
    return db_list_users()


def update_user(user_id: int, role: str | None, is_active: bool | None) -> dict | None:
    row = db_update_user(user_id, role, is_active)
    return _public_user(row) if row else None


def change_password(user_id: int, current_password: str, new_password: str) -> bool:
    row = db_get_user(user_id)
    if not row or not _verify_password(current_password, row["password_hash"]):
        return False
    db_update_password(user_id, _hash_password(new_password))
    return True


def reset_password(user_id: int, password: str) -> bool:
    return db_update_password(user_id, _hash_password(password))
