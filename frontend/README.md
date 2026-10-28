# Waypoint frontend

React + TypeScript interface for the game walkthrough backend. Includes a searchable game library, question sessions, source citations, source imports/deletion, and optional generated answers.

## Development

Use the Node version in the repository's `.nvmrc` (Node 24):

```sh
nvm use
cd frontend
npm install
npm run dev
```

Start FastAPI in another terminal:

```sh
cd backend
.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Open the Local URL printed by Vite (normally http://localhost:5173). Vite proxies `/api` to http://localhost:8000.

## First session

1. Add a game using its title and a unique identifier.
2. Choose **Add a source**. Supply the original source URL, title, and walkthrough text. URL-only imports require the backend's source-host allowlist.
3. Ask a question. Select **Context & filters** to include your location/objective, platform, or game version.
4. Open supporting passages or follow a citation to its original guide.

**Source passages** works without a model. **Generated guidance** becomes selectable when `/api/health` reports a configured Ollama model. Configuration does not guarantee the model is currently available; model errors appear alongside the question form.

If the backend requires an admin key, enter it in **Workspace settings** before adding games or changing sources. It stays in memory only. Game/source data persists in the backend. Questions and answers are held in memory and reset when switching games or reloading. Each query is independent; include earlier details in the context field for follow-up questions. Press `/` to focus library search; Enter sends a question and Shift+Enter adds a line break.

## Build and deployment

```sh
npm run build
```

Serve `dist/` with an `/api` reverse proxy to FastAPI on the same origin. The development proxy is not included in the production bundle. `npm run preview` is only a static build preview and does not configure a backend proxy. No secrets are embedded in the build. Google Fonts is optional; system fallback fonts are used when unavailable.

## Checks

```sh
npm run build
npm run test
```

Tests exercise API errors and cancellation, empty-library rendering, and the game → source → query contract against a temporary FastAPI database. The integration test requires the backend virtual environment. They do not replace browser interaction or visual testing.
