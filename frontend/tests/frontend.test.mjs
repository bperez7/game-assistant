import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { api } from '../src/api.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('API client handles successful JSON and empty delete responses', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/games')
    assert.equal(options.headers['Content-Type'], 'application/json')
    return Response.json([{ id: 'game-id', title: 'Test game' }])
  }
  assert.equal((await api('/games'))[0].id, 'game-id')
  globalThis.fetch = async () => new Response(null, { status: 204 })
  assert.equal(await api('/games/example/sources/example', { method: 'DELETE' }), undefined)
})

test('API client exposes backend and validation errors', async () => {
  globalThis.fetch = async () => Response.json({ detail: 'A valid X-Admin-Key is required' }, { status: 401 })
  await assert.rejects(api('/games'), /valid X-Admin-Key/)
  globalThis.fetch = async () => Response.json({ detail: [{ loc: ['body', 'question'], msg: 'Too short' }] }, { status: 422 })
  await assert.rejects(api('/games/example/query'), /question: Too short/)
  globalThis.fetch = async () => new Response('Bad gateway', { status: 502 })
  await assert.rejects(api('/health'), /Request failed \(502\)/)
})

test('API client distinguishes network failures from cancelled requests', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  await assert.rejects(api('/health'), /Cannot reach the backend/)
  globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError') }
  await assert.rejects(api('/health'), { name: 'AbortError' })
})

test('initial app renders accessible empty-library setup', async () => {
  const { createServer } = await import('vite')
  const { renderToString } = await import('react-dom/server')
  const { createElement } = await import('react')
  const server = await createServer({ root: join(root, 'frontend'), server: { middlewareMode: true, hmr: false }, logLevel: 'silent' })
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.tsx')
    const html = renderToString(createElement(App))
    assert.match(html, /Waypoint/)
    assert.match(html, /Add your first game/)
    assert.match(html, /aria-label="Game library"/)
    assert.match(html, /aria-label="Search your games"/)
    assert.doesNotMatch(html, /Click to call the backend/)
  } finally { await server.close() }
})

test('frontend API contract works with the real backend from catalog through cited answers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'waypoint-contract-'))
  const headers = { 'X-Admin-Key': 'integration-key' }
  globalThis.fetch = async (url, options) => {
    const response = JSON.parse(execFileSync(join(root, 'backend/.venv/bin/python'), [join(root, 'frontend/tests/backend_bridge.py')], {
      input: JSON.stringify({ database: join(directory, 'test.db'), path: url, method: options.method || 'GET', headers: options.headers, body: options.body }),
      encoding: 'utf8',
    }))
    return new Response(response.status === 204 ? null : response.body, { status: response.status, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    assert.deepEqual(await api('/games?limit=100&offset=0'), [])
    assert.equal((await api('/health')).generation_configured, false)
    await assert.rejects(api('/games', { method: 'POST', body: JSON.stringify({ title: 'Quest', slug: 'quest' }) }), /Admin-Key/)
    const game = await api('/games', { method: 'POST', headers, body: JSON.stringify({ title: 'Lantern Quest', slug: 'lantern-quest' }) })
    const source = await api(`/games/${game.id}/sources`, { method: 'POST', headers, body: JSON.stringify({
      title: 'Guardian guide', url: 'https://guides.example/guardian', platform: 'PC', version: '1.0',
      text: 'To defeat the crystal guardian, equip the silver shield. Block its beam, then strike the exposed crystal.',
    }) })
    assert.equal((await api(`/games/${game.id}/sources`)).length, 1)
    const answer = await api(`/games/${game.id}/query`, { method: 'POST', body: JSON.stringify({ question: 'How do I defeat the crystal guardian?', context: '', mode: 'extractive', platform: 'PC', version: '1.0' }) })
    assert.equal(answer.status, 'answered')
    assert.match(answer.answer, /silver shield/)
    assert.equal(answer.citations[0].source_id, source.id)
    assert.equal(answer.citations[0].url, source.url)
    assert.equal(await api(`/games/${game.id}/sources/${source.id}`, { method: 'DELETE', headers }), undefined)
    assert.equal((await api(`/games/${game.id}/query`, { method: 'POST', body: JSON.stringify({ question: 'crystal guardian' }) })).status, 'insufficient_context')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
