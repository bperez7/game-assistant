# Game walkthrough backend

FastAPI API for selecting a game, indexing walkthroughs from multiple sources, and asking questions with source citations. SQLite persists the catalog and searchable passages. No external service is required for the default extractive mode.

## Run

From the repository root:

```sh
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Python 3.9+ and a SQLite build with FTS5 are required. Interactive API docs: http://localhost:8000/docs. The existing frontend's `/api/hello` endpoint is preserved. Configuration loads from `backend/.env` when running from `backend/`.

## Try the complete flow

Create a game and copy its `id` from the response:

```sh
curl -X POST http://localhost:8000/api/games \
  -H 'Content-Type: application/json' \
  -d '{"title":"Lantern Quest","slug":"lantern-quest"}'
```

The example below is **fictional sample content**, not a real guide. Set `GAME_ID` to the returned ID, then add source text:

```sh
GAME_ID=replace-with-returned-id
curl -X POST "http://localhost:8000/api/games/$GAME_ID/sources" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Crystal Guardian Guide","url":"https://guides.example/lantern-quest/guardian","text":"To defeat the crystal guardian, equip the silver shield. Block its beam, then strike the exposed crystal. Retreat when its armor begins to glow and repeat after the shockwave passes.","platform":"PC","version":"1.0"}'

curl -X POST "http://localhost:8000/api/games/$GAME_ID/query" \
  -H 'Content-Type: application/json' \
  -d '{"question":"How do I defeat the crystal guardian?","platform":"PC","version":"1.0"}'
```

The response contains `answer`, `status`, `mode`, and `citations`. Each citation includes the source title, URL, passage text, and identifiers. Import more guides under the same game to retrieve across sites. Importing the same URL for the same game atomically replaces its passages and metadata; it does not accumulate stale content. URL fragments are ignored for source identity.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database check and generation configuration status |
| GET | `/api/games?q=&limit=50&offset=0` | Search the local catalog by title |
| POST | `/api/games` | Create a game using `title` and unique `slug` |
| GET | `/api/games/{game_id}` | Get the selected game |
| GET | `/api/games/{game_id}/sources` | List indexed sources and chunk counts |
| POST | `/api/games/{game_id}/sources` | Index supplied `text`, or fetch `url` when text is omitted |
| DELETE | `/api/games/{game_id}/sources/{source_id}` | Delete source and searchable passages |
| POST | `/api/games/{game_id}/query` | Query using `question`, optional `context`, `platform`, `version`, `top_k`, and `mode` |

Queries are stateless. Pass the user's current location, objective, or relevant prior conversation in `context`. Platform/version filters exclude known mismatches; untagged sources remain eligible. These filters cannot establish that untagged material is compatible. Sources must belong to the selected game: there is no cross-game retrieval.

Write endpoints require `X-Admin-Key` when `WALKTHROUGH_ADMIN_KEY` is set. The default is for local development. Set a strong key before making the backend accessible to others. Read and query endpoints have no user authentication or rate limiting; add these at the deployment boundary before public use. CORS defaults to the Vite development origin and is configurable as a JSON list.

## Fetching websites

The supplied `.env.example` enables IGN, GameFAQs (including `gamefaqs.gamespot.com`), Neoseeker (including `faqs.neoseeker.com`), PowerPyx, and StrategyWiki, with explicit apex/`www` hostnames. Copy it to `.env` to use that allowlist. To customize the approved sites, set exact hostnames in `.env`:

```dotenv
WALKTHROUGH_ALLOWED_SOURCE_HOSTS=["your-approved-guide-host.example"]
```

POST the source URL and title without `text`. The importer checks `robots.txt`, fetches one page, strips scripts/navigation, and indexes readable text. It does not discover URLs, crawl an entire site, execute JavaScript, or bypass access restrictions. Use canonical HTTPS URLs: redirects are rejected. Login-only pages, PDFs, and JavaScript-only guides are unsupported. Supplied `text` bypasses fetching and the host allowlist; its URL is attribution metadata only.

Remote fetching uses public IP validation and pins the checked address when opening the TLS connection, retaining hostname verification. Requests have a 10-second socket timeout and a 2 MB response cap; extracted text is limited to 500,000 characters. Private, loopback, and link-local targets are rejected. Robots errors other than a missing file fail closed. Ingestion is synchronous and intended for individually curated pages; large imports should move to a job queue with per-host throttling.

## Optional generated answers

Install/run Ollama separately, pull a model suitable for your machine, and configure its exact name:

```dotenv
WALKTHROUGH_OLLAMA_MODEL=your-installed-model
WALKTHROUGH_OLLAMA_URL=http://localhost:11434
```

Restart the API and send `"mode":"generate"` in a query. The backend retrieves passages, sends only those passages plus the question/context to Ollama, and asks for a structured answer with inline citations. Returned citation numbers must refer to retrieved passages and match the inline references. No provider SDK or API key is required. Configure only a trusted Ollama endpoint; retrieved content and query text are sent there.

Generation is optional and explicit: missing configuration returns 503; provider failures or invalid citations return 502. There is no silent substitution of extractive output. `GET /api/health` reports configuration, not Ollama availability. The automated tests mock Ollama; actual model quality and latency must be evaluated with your chosen local model. Citation validation checks references, not whether every generated claim follows from its source.

## Retrieval and limitations

Documents split into overlapping 180-word passages (30-word overlap). SQLite FTS5 performs stemmed lexical search ranked with BM25, then diversifies results across sources. This is a lightweight retrieval foundation, **not embedding-based semantic search**. Extractive mode returns passages verbatim; it does not claim to synthesize new instructions. Generated mode adds retrieval-augmented synthesis through Ollama. Questions with no lexical matches return `insufficient_context` without calling a model. Partial keyword overlap can still retrieve irrelevant passages; this first version has no calibrated relevance threshold, synonym expansion, or confidence score.

The catalog starts empty. It has no automatic game database integration or live web search. Future improvements include evaluated hybrid/embedding retrieval, background ingestion, conversation storage, and dedicated spoiler/progression controls. Walkthrough passages may contain spoilers.

## Tests

```sh
cd backend
.venv/bin/python -m unittest discover -s tests -v
```

Tests use temporary databases and mocked network/model responses. They cover persistence, game isolation, source replacement/deletion, platform/version filtering, citation validation, request validation, admin protection, no-result behavior, HTML extraction, robots policy, response limits, and SSRF restrictions.

Implementation references: [SQLite FTS5 and BM25](https://www.sqlite.org/fts5.html), [Ollama chat API](https://docs.ollama.com/api/chat), and [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/).
