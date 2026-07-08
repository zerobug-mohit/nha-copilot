"""Central configuration, loaded from environment / .env.

Every external coordinate (GCP project, dataset, table names, credentials,
OpenAI key/model, JWT secret) lives here so nothing is hardcoded elsewhere.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ directory (this file is backend/app/config.py)
BACKEND_DIR = Path(__file__).resolve().parent.parent
# repo root that holds the reference data files (one level above nha-copilot/)
PROJECT_ROOT = BACKEND_DIR.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # BigQuery
    gcp_project: str = "nha-conversational-analytics"
    bq_dataset: str = "nha_conversational_analytics"
    bq_tms_table: str = "TMS_Sample"
    bq_bis_table: str = "BIS_Updated_Sample"
    # Single denormalised table the co-pilot queries (BIS LEFT JOIN TMS).
    bq_merged_table: str = "BIS_TMS_Sample_Merged"
    # Auth to BigQuery — provide EITHER of these (inline JSON takes precedence):
    #   google_credentials_json : the full service-account key JSON, inline
    #   google_application_credentials : a path to the key file
    google_credentials_json: str = ""
    google_application_credentials: str = ""
    bq_max_bytes_billed: int = 2_147_483_648  # 2 GB

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    # A (typically stronger) model for the Explorer's idea generation. Falls back
    # to openai_model when unset. e.g. "gpt-4.1" or a reasoning model.
    openai_explorer_model: str = ""

    # Auth
    jwt_secret: str = "change-me-to-a-long-random-string"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    # Production users, set via env to override the dev seed accounts. Format:
    #   APP_USERS="user1:password1:role1;user2:password2:role2"
    # Roles: viewer | analyst | senior_analyst | admin. Empty = dev seed users.
    app_users: str = ""

    # App
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Folder holding lgd_master.xlsx / HBP-2022.pdf. Bundled in backend/reference
    # so a fresh clone is self-contained. Resolved relative to backend/.
    reference_data_dir: str = "reference"

    # ----- derived helpers -----
    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def reference_dir(self) -> Path:
        p = Path(self.reference_data_dir)
        if not p.is_absolute():
            p = (BACKEND_DIR / p).resolve()
        return p

    def table_ref(self, which: str) -> str:
        """Fully qualified, backtick-quoted BigQuery table reference."""
        table = {
            "tms": self.bq_tms_table,
            "bis": self.bq_bis_table,
            "merged": self.bq_merged_table,
        }.get(which, self.bq_merged_table)
        return f"`{self.gcp_project}.{self.bq_dataset}.{table}`"


@lru_cache
def get_settings() -> Settings:
    return Settings()
