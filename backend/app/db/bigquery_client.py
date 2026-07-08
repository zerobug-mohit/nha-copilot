"""Read-only BigQuery access layer.

This is the only module that talks to BigQuery. It executes SELECT statements
against a service account whose IAM grants are read-only (dataViewer + jobUser).
That IAM restriction is the third independent safety layer described in the
architecture (§4.4): even if the SQL validator and the LLM system prompt both
fail, the database itself rejects any write.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from google.api_core.exceptions import GoogleAPIError

from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class QueryResult:
    columns: list[str] = field(default_factory=list)
    rows: list[dict[str, Any]] = field(default_factory=list)
    row_count: int = 0
    bytes_processed: int | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


class BigQueryClient:
    """Thin, lazily-initialised wrapper around google-cloud-bigquery."""

    def __init__(self) -> None:
        self._client = None  # created on first use
        self._settings = get_settings()

    def _get_client(self):
        if self._client is None:
            # Imported lazily so the module imports even without credentials
            # configured (e.g. during unit tests of other layers).
            import json

            from google.cloud import bigquery

            inline = (self._settings.google_credentials_json or "").strip()
            creds_path = self._settings.google_application_credentials
            if inline:
                # Full service-account key JSON provided inline in .env.
                info = json.loads(inline)
                self._client = bigquery.Client.from_service_account_info(
                    info, project=self._settings.gcp_project
                )
            elif creds_path:
                self._client = bigquery.Client.from_service_account_json(
                    creds_path, project=self._settings.gcp_project
                )
            else:
                # Fall back to ambient credentials (ADC) if nothing is set.
                self._client = bigquery.Client(project=self._settings.gcp_project)
        return self._client

    def dry_run(self, sql: str) -> QueryResult:
        """Validate + estimate bytes without executing. Never bills."""
        from google.cloud import bigquery

        try:
            client = self._get_client()
            job = client.query(
                sql,
                job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False),
            )
            return QueryResult(bytes_processed=job.total_bytes_processed)
        except GoogleAPIError as exc:
            return QueryResult(error=str(exc))

    def run_select(self, sql: str) -> QueryResult:
        """Execute a validated SELECT and return rows as dicts.

        Callers MUST pass SQL that has already gone through the safety validator.
        A maximum_bytes_billed cap protects against runaway scans.
        """
        from google.cloud import bigquery

        try:
            client = self._get_client()
            job_config = bigquery.QueryJobConfig(
                use_legacy_sql=False,
                maximum_bytes_billed=self._settings.bq_max_bytes_billed,
            )
            job = client.query(sql, job_config=job_config)
            iterator = job.result()  # waits for completion
            columns = [f.name for f in iterator.schema]
            rows = [dict(row.items()) for row in iterator]
            return QueryResult(
                columns=columns,
                rows=rows,
                row_count=len(rows),
                bytes_processed=job.total_bytes_processed,
            )
        except GoogleAPIError as exc:
            logger.warning("BigQuery execution error: %s", exc)
            return QueryResult(error=str(exc))
        except Exception as exc:  # noqa: BLE001 - surface anything as a caught failure
            logger.exception("Unexpected BigQuery failure")
            return QueryResult(error=str(exc))


_client: BigQueryClient | None = None


def get_bigquery_client() -> BigQueryClient:
    global _client
    if _client is None:
        _client = BigQueryClient()
    return _client
