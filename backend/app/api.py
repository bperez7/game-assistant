from typing import Optional
import secrets
import sqlite3
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from .answers import GenerationError, answer_question
from .config import Settings
from .ingestion import SourceError, fetch_walkthrough
from .models import Answer, Game, GameCreate, Question, Source, SourceCreate
from .store import Store


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings()
    store = Store(settings.database_path)

    @asynccontextmanager
    async def lifespan(app):
        store.initialize()
        yield

    app = FastAPI(title="Game Walkthrough Assistant", version="0.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "X-Admin-Key"])

    def require_admin(x_admin_key: Annotated[Optional[str], Header()] = None):
        if settings.admin_key and not secrets.compare_digest(x_admin_key or "", settings.admin_key):
            raise HTTPException(401, "A valid X-Admin-Key is required")

    def require_game(game_id: str):
        game = store.game(game_id)
        if not game:
            raise HTTPException(404, "Game not found")
        return game

    @app.get("/api/hello")
    def hello():
        return {"message": "Hello from the backend!"}

    @app.get("/api/health")
    def health():
        with store.connect() as db:
            db.execute("SELECT count(*) FROM games").fetchone()
        return {"status": "ok", "retrieval": "sqlite-fts5", "generation_configured": bool(settings.ollama_model)}

    @app.get("/api/games", response_model=list[Game])
    def games(q: str = Query(default="", max_length=200), limit: int = Query(default=50, ge=1, le=100),
              offset: int = Query(default=0, ge=0)):
        return store.games(q, limit, offset)

    @app.post("/api/games", response_model=Game, status_code=201, dependencies=[Depends(require_admin)])
    def create_game(body: GameCreate):
        try:
            return store.create_game(body.title, body.slug)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Game slug already exists") from exc

    @app.get("/api/games/{game_id}", response_model=Game)
    def get_game(game_id: str):
        return require_game(game_id)

    @app.get("/api/games/{game_id}/sources", response_model=list[Source])
    def sources(game_id: str):
        require_game(game_id)
        return store.sources(game_id)

    @app.post("/api/games/{game_id}/sources", response_model=Source, status_code=201,
              dependencies=[Depends(require_admin)])
    def ingest(game_id: str, body: SourceCreate):
        require_game(game_id)
        try:
            text = body.text if body.text is not None else fetch_walkthrough(str(body.url), settings.allowed_source_hosts)
        except SourceError as exc:
            raise HTTPException(422, str(exc)) from exc
        return store.ingest(game_id, body, text)

    @app.delete("/api/games/{game_id}/sources/{source_id}", status_code=204,
                dependencies=[Depends(require_admin)])
    def delete_source(game_id: str, source_id: str):
        require_game(game_id)
        if not store.delete_source(game_id, source_id):
            raise HTTPException(404, "Source not found")
        return Response(status_code=204)

    @app.post("/api/games/{game_id}/query", response_model=Answer)
    def query(game_id: str, body: Question):
        game = require_game(game_id)
        try:
            return answer_question(game_id, game["title"], body, store.search(game_id, body), settings)
        except GenerationError as exc:
            raise HTTPException(503 if not settings.ollama_model else 502, str(exc)) from exc

    return app
