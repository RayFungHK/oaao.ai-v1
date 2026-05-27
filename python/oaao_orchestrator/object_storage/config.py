from __future__ import annotations

import os
from typing import Any


DOMAIN_ENV_ROOT: dict[str, str] = {
    "vault": "OAAO_VAULT_STORAGE",
    "chat_attachments": "OAAO_CHAT_ATTACHMENT_ROOT",
    "slide_projects": "OAAO_SLIDE_PROJECT_ROOT",
    "slide_templates": "OAAO_SLIDE_TEMPLATE_CUSTOM_ROOT",
    "live_meeting": "OAAO_LIVE_MEETING_ROOT",
    "mine": "OAAO_MINE_DATA_ROOT",
    "agent_materials": "OAAO_AGENT_MATERIAL_ROOT",
}

DOMAIN_DEFAULT_ROOT: dict[str, str] = {
    "vault": "/var/www/html/storage/vault",
    "chat_attachments": "/var/www/html/storage/chat-attachments",
    "slide_projects": "/var/www/html/storage/slide-projects",
    "slide_templates": "/var/www/html/storage/slide-templates/custom",
    "live_meeting": "/var/www/html/storage/live-meeting",
    "mine": "/var/www/html/storage/mine",
    "agent_materials": "/var/www/html/storage/agent-materials",
}


def domain_local_root(domain: str) -> str:
    env_key = DOMAIN_ENV_ROOT.get(domain, "OAAO_VAULT_STORAGE")
    env = os.getenv(env_key, "").strip()
    if env:
        return env.rstrip("/")
    return DOMAIN_DEFAULT_ROOT.get(domain, "/var/www/html/storage/vault").rstrip("/")


def resolve_credentials(credentials_env: str) -> dict[str, str]:
    prefix = credentials_env.strip()
    if not prefix:
        return {}
    out: dict[str, str] = {}
    for suffix in ("ACCESS_KEY", "SECRET_KEY", "TOKEN", "ENDPOINT_URL", "PROJECT"):
        val = os.getenv(f"{prefix}_{suffix}", "").strip()
        if val:
            out[suffix.lower()] = val
    return out


def resolve_credentials_from_domain_config(domain_config: dict[str, Any]) -> dict[str, str]:
    """Inline credentials from tenant storage_json take precedence over env prefix."""
    inline = domain_config.get("credentials")
    if isinstance(inline, dict):
        out: dict[str, str] = {}
        for key in ("access_key", "secret_key", "token", "endpoint_url", "project"):
            val = str(inline.get(key) or "").strip()
            if val and val != "••••••":
                out[key] = val
        if out:
            return out
    return resolve_credentials(str(domain_config.get("credentials_env") or ""))


def merge_domain_config(default_cfg: dict[str, Any], domains: dict[str, Any], domain: str) -> dict[str, Any]:
    base = dict(default_cfg or {})
    override = domains.get(domain) if isinstance(domains, dict) else None
    if isinstance(override, dict):
        base.update(override)
    return base
