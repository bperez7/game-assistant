from typing import Optional
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WALKTHROUGH_", env_file=".env", extra="ignore")

    database_path: Path = Path(__file__).resolve().parents[1] / "data" / "walkthrough.db"
    cors_origins: list[str] = ["http://localhost:5173"]
    admin_key: Optional[str] = None
    allowed_source_hosts: list[str] = []
    ollama_url: str = "http://localhost:11434"
    ollama_model: Optional[str] = None

    openai_api_key: Optional[SecretStr] = None
    openai_model: str = "gpt-4o-mini"

    @property
    def generation_configured(self) -> bool:
        return bool(self.openai_api_key or self.ollama_model)
