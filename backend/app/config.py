from typing import Optional
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WALKTHROUGH_", env_file=".env", extra="ignore")

    database_path: Path = Path(__file__).resolve().parents[1] / "data" / "walkthrough.db"
    cors_origins: list[str] = ["http://localhost:5173"]
    admin_key: Optional[str] = None
    allowed_source_hosts: list[str] = []
    ollama_url: str = "http://localhost:11434"
    ollama_model: Optional[str] = None
