"""Per-tenant object storage drivers (local / S3 / GCS / Hugging Face buckets)."""

from oaao_orchestrator.object_storage.locator import StorageLocator, parse_locator
from oaao_orchestrator.object_storage.materialize import materialize_locator

__all__ = ["StorageLocator", "parse_locator", "materialize_locator"]
