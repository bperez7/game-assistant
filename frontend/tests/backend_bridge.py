"""Exercise the real API without opening ports or touching the user's database."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from fastapi.testclient import TestClient
from app.api import create_app
from app.config import Settings

request = json.load(sys.stdin)
settings = Settings(
    database_path=Path(request["database"]),
    admin_key="integration-key",
    ollama_model=None,
    allowed_source_hosts=[],
    _env_file=None,
)
with TestClient(create_app(settings)) as client:
    response = client.request(
        request["method"], request["path"],
        content=request.get("body"), headers=request.get("headers", {}),
    )
    print(json.dumps({"status": response.status_code, "body": response.text}))
