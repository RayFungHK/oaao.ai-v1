"""W10-S1 — Stream token strong validation.

Replaces the ad-hoc `secrets.token_hex(24)` + dict-lookup pattern with a
single module that enforces:

- minimum/maximum length (rejects accidentally-truncated tokens and
  DoS-via-megabyte-token payloads),
- strict hex-only charset (rejects path-traversal / control-char
  injection in query strings),
- optional TTL with monotonic-clock expiry (tokens minted by
  `mint_stream_token()` auto-expire after `OAAO_STREAM_TOKEN_TTL_SEC`),
- constant-time comparison via `hmac.compare_digest`.

The legacy `_stream_tokens: dict[str, str]` storage in `app.py` and
`live_meeting/hub.py` can migrate to `StreamTokenStore` incrementally;
this module is the canonical surface.
"""

from __future__ import annotations

import hmac
import logging
import os
import re
import secrets
import threading
import time

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Format validation
# --------------------------------------------------------------------------- #


# Default mint produces 24 bytes = 48 hex chars. Accept 32..128 to allow
# upgrades without breaking deployments mid-rotation.
MIN_TOKEN_LEN = 32
MAX_TOKEN_LEN = 128

_TOKEN_RE = re.compile(r"^[0-9a-f]+$")


def is_valid_token_format(token: str) -> bool:
    """Pure format check — no store lookup. Constant time wrt length only."""
    if not isinstance(token, str):
        return False
    n = len(token)
    if n < MIN_TOKEN_LEN or n > MAX_TOKEN_LEN:
        return False
    return bool(_TOKEN_RE.match(token))


# --------------------------------------------------------------------------- #
# TTL config
# --------------------------------------------------------------------------- #


def stream_token_ttl_seconds() -> float:
    """Mint TTL. 0 = never expire (legacy behaviour)."""
    raw = (os.environ.get("OAAO_STREAM_TOKEN_TTL_SEC") or "").strip()
    if not raw:
        return 0.0
    try:
        value = float(raw)
    except ValueError:
        return 0.0
    return max(0.0, value)


# --------------------------------------------------------------------------- #
# Store
# --------------------------------------------------------------------------- #


class StreamTokenStore:
    """Thread-safe stream-token store with optional TTL.

    The store keys on an opaque `subject_id` (`run_id`, `session_id`, etc.).
    Callers MUST validate format **before** any store lookup so a malformed
    token can never trigger a comparison against a real secret.
    """

    def __init__(self, *, ttl_seconds: float | None = None) -> None:
        self._ttl = ttl_seconds if ttl_seconds is not None else stream_token_ttl_seconds()
        self._lock = threading.Lock()
        self._store: dict[str, tuple[str, float]] = {}

    def mint(self, subject_id: str, *, nbytes: int = 24) -> str:
        if not subject_id:
            raise ValueError("subject_id must be a non-empty string")
        token = secrets.token_hex(max(16, nbytes))
        expiry = (
            time.monotonic() + self._ttl if self._ttl > 0 else float("inf")
        )
        with self._lock:
            self._store[subject_id] = (token, expiry)
        return token

    def validate(self, subject_id: str, supplied: str) -> bool:
        """Constant-time validation + TTL enforcement."""
        if not subject_id or not is_valid_token_format(supplied or ""):
            return False
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(subject_id)
            if entry is None:
                return False
            expected, expiry = entry
            if expiry <= now:
                # Expired — purge eagerly so a slow client can't replay.
                del self._store[subject_id]
                logger.info("stream_token expired subject_id=%s", subject_id)
                return False
        return hmac.compare_digest(expected, supplied)

    def revoke(self, subject_id: str) -> bool:
        with self._lock:
            return self._store.pop(subject_id, None) is not None

    def clear(self) -> None:
        """Test / teardown helper — drop all minted tokens."""
        with self._lock:
            self._store.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)
