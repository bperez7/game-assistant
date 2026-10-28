import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .models import SourceCreate

STOP_WORDS = set("a an the is are was were to of for in on at and or i me my how what where do does can should with it this get please help".split())


def chunks(text: str, size: int = 180, overlap: int = 30) -> list[str]:
    words = text.split()
    result = []
    for start in range(0, len(words), size - overlap):
        result.append(" ".join(words[start:start + size]))
        if start + size >= len(words):
            break
    return result


class Store:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS games (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE
                );
                CREATE TABLE IF NOT EXISTS sources (
                    id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id),
                    url TEXT NOT NULL, title TEXT NOT NULL, platform TEXT, version TEXT,
                    updated_at TEXT NOT NULL, chunk_count INTEGER NOT NULL,
                    UNIQUE(game_id, url)
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts5(
                    text, source_id UNINDEXED, game_id UNINDEXED,
                    tokenize='porter unicode61'
                );
            """)

    def game(self, game_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            return dict(row) if row else None

    def games(self, query, limit, offset):
        with self.connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT * FROM games WHERE instr(lower(title), lower(?)) > 0 ORDER BY title, id LIMIT ? OFFSET ?",
                (query, limit, offset),
            )]

    def create_game(self, title, slug):
        game_id = str(uuid4())
        with self.connect() as db:
            db.execute("INSERT INTO games VALUES (?, ?, ?)", (game_id, title, slug))
        return self.game(game_id)

    def sources(self, game_id):
        with self.connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT * FROM sources WHERE game_id = ? ORDER BY title, id", (game_id,)
            )]

    def ingest(self, game_id: str, source: SourceCreate, text: str):
        passages = chunks(text)
        url = str(source.url).split("#", 1)[0]
        with self.connect() as db:
            existing = db.execute("SELECT id FROM sources WHERE game_id = ? AND url = ?", (game_id, url)).fetchone()
            source_id = existing["id"] if existing else str(uuid4())
            db.execute("DELETE FROM passages WHERE source_id = ?", (source_id,))
            db.execute("""INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(game_id, url) DO UPDATE SET title=excluded.title,
                platform=excluded.platform, version=excluded.version,
                updated_at=excluded.updated_at, chunk_count=excluded.chunk_count""",
                (source_id, game_id, url, source.title, source.platform, source.version,
                 datetime.now(timezone.utc).isoformat(), len(passages)))
            db.executemany("INSERT INTO passages(text, source_id, game_id) VALUES (?, ?, ?)",
                           [(p, source_id, game_id) for p in passages])
            return dict(db.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone())

    def delete_source(self, game_id, source_id):
        with self.connect() as db:
            row = db.execute("SELECT id FROM sources WHERE id = ? AND game_id = ?", (source_id, game_id)).fetchone()
            if not row:
                return False
            db.execute("DELETE FROM passages WHERE source_id = ?", (source_id,))
            db.execute("DELETE FROM sources WHERE id = ?", (source_id,))
            return True

    def search(self, game_id, question):
        terms = list(dict.fromkeys(t.lower() for t in re.findall(r"[^\W_]+", question.question + " " + question.context)
                                   if t.lower() not in STOP_WORDS))[:40]
        if not terms:
            return []
        expression = " OR ".join('"' + term + '"' for term in terms)
        with self.connect() as db:
            rows = db.execute("""
                SELECT passages.rowid AS chunk_id, passages.text, s.id AS source_id,
                       s.title, s.url, bm25(passages) AS score
                FROM passages JOIN sources s ON s.id = passages.source_id
                WHERE passages MATCH ? AND passages.game_id = ?
                AND (? IS NULL OR s.platform IS NULL OR lower(s.platform) = lower(?))
                AND (? IS NULL OR s.version IS NULL OR lower(s.version) = lower(?))
                ORDER BY score, passages.rowid LIMIT ?
            """, (expression, game_id, question.platform, question.platform,
                  question.version, question.version, question.top_k * 4)).fetchall()
        # Round-robin sources so one long guide does not monopolize the context.
        selected, seen = [], set()
        for row in rows:
            if row["source_id"] not in seen:
                selected.append(dict(row))
                seen.add(row["source_id"])
        selected_ids = {r["chunk_id"] for r in selected}
        selected.extend(dict(r) for r in rows if r["chunk_id"] not in selected_ids)
        return selected[:question.top_k]
