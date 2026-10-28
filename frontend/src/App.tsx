import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, errorMessage } from './api';
import type { Answer, Game, Health, Source } from './api';
import { Icon } from './Icons';
import './App.css';
type ModalKind = 'game' | 'source' | 'settings' | null;
interface Turn {
  id: number;
  question: string;
  answer: Answer;
}
const suggestions = [{
  icon: 'flag',
  title: 'Find my next step',
  text: 'Where should I go next?',
  hint: 'Get back on the right path'
}, {
  icon: 'shield',
  title: 'Get past a tough fight',
  text: 'How do I defeat this boss?',
  hint: 'A strategy for the challenge ahead'
}, {
  icon: 'search',
  title: 'Find something hidden',
  text: 'Where can I find this item?',
  hint: 'Leave no stone unturned'
}];
function Modal({
  title,
  children,
  close
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className="modal" onCancel={e => {
    e.preventDefault();
    close();
  }} onClick={e => {
    if (e.target === e.currentTarget) close();
  }}>
    <div className="modal-head">
      <div>
        <span className="eyebrow">YOUR FIELD GUIDE</span>
        <h2 id={titleId}>{title}</h2>
      </div>
      <button type="button" className="icon-button" aria-label="Close dialog" onClick={close}>
        <Icon name="close" />
      </button>
    </div>
    {children}
  </dialog>;
}
function App() {
  const searchInput = useRef<HTMLInputElement>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [selected, setSelected] = useState<Game | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [adminKey, setAdminKey] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [sourceRefresh, setSourceRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [sourceMode, setSourceMode] = useState<'text' | 'url'>('text');
  const [gameTitle, setGameTitle] = useState('');
  const [gameSlug, setGameSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    async function load() {
      try {
        // Fetch every catalog page; the API caps each page at 100 games.
        const all: Game[] = [];
        for (let offset = 0;; offset += 100) {
          const page = await api<Game[]>(`/games?limit=100&offset=${offset}`, {
            signal: controller.signal
          });
          all.push(...page);
          if (page.length < 100) break;
        }
        if (controller.signal.aborted) return;
        setGames(all);
        setSelected(current => all.find(g => g.id === current?.id) || all[0] || null);
      } catch (err) {
        if (!controller.signal.aborted) setError(errorMessage(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    api<Health>('/health', {
      signal: controller.signal
    }).then(setHealth).catch(() => {
      if (!controller.signal.aborted) setHealth(null);
    });
    return () => controller.abort();
  }, [refresh]);
  function openModal(kind: ModalKind) {
    setFormError('');
    setModal(kind);
    setGameTitle('');
    setGameSlug('');
    setSlugEdited(false);
  }
  async function submitGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const game = await api<Game>('/games', {
        method: 'POST',
        headers: {
          'X-Admin-Key': adminKey
        },
        body: JSON.stringify({
          title: gameTitle,
          slug: gameSlug
        })
      });
      setGames(current => [...current, game].sort((a, b) => a.title.localeCompare(b.title)));
      setSelected(game);
      setSearch('');
      setModal(null);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const targetGameId = selected.id;
    setSaving(true);
    setFormError('');
    try {
      await api(`/games/${targetGameId}/sources`, {
        method: 'POST',
        headers: {
          'X-Admin-Key': adminKey
        },
        body: JSON.stringify({
          title: data.get('title'),
          url: data.get('url'),
          ...(sourceMode === 'text' ? {
            text: data.get('text')
          } : {}),
          platform: data.get('platform') || null,
          version: data.get('version') || null
        })
      });
      setSourceRefresh(n => n + 1);
      setModal(null);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || modal) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      searchInput.current?.focus();
    }
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [modal]);
  const filtered = games.filter(game => game.title.toLowerCase().includes(search.toLowerCase()));
  return <div className="app-shell">
    <aside className="library">
      <a className="brand" href="#main">
        <span className="brand-mark">
          <Icon name="compass" size={28} />
        </span>
        <span>Waypoint<span className="brand-sub">A GUIDE FOR EVERY QUEST</span></span>
      </a>
      <div className="library-label">
        <span className="eyebrow">YOUR LIBRARY</span>
        <span className="count">{games.length.toString().padStart(2, '0')}</span>
      </div>
      <label className="search">
        <Icon name="search" size={17} />
        <input ref={searchInput} aria-label="Search your games" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a game…" />
        <kbd>/</kbd>
      </label>
      <nav className="game-list" aria-label="Game library">
        {loading ? <p className="small muted" role="status">Loading your library…</p> : error ? <div className="error" role="alert">
          {error}
          <button className="text-button" onClick={() => setRefresh(n => n + 1)}>Retry connection</button>
        </div> : filtered.length ? filtered.map((game, i) => <button key={game.id} className={`game-item ${selected?.id === game.id ? 'active' : ''}`} aria-pressed={selected?.id === game.id} onClick={() => setSelected(game)}>
          <span className={`game-art art-${i % 4}`}>
            <Icon name={['compass', 'shield', 'flag', 'spark'][i % 4]} size={22} />
          </span>
          <span className="game-name">
            {game.title}
            <small>{selected?.id === game.id ? 'Currently exploring' : 'Open walkthrough'}</small>
          </span>
          {selected?.id === game.id && <span className="active-dot" />}
        </button>) : <p className="small muted">{search ? 'No games match your search.' : 'Your next adventure starts here. Add your first game.'}</p>}
      </nav>
      <button className="add-game" onClick={() => openModal('game')}><Icon name="plus" size={17} /> Add a game</button>
      <div className="library-bottom">
        <div className="field-note">
          <Icon name="book" size={21} />
          <h3>A little guidance.<br />A lot more adventure.</h3>
          <p>Walkthroughs from your trusted sources, all in one place.</p>
        </div>
        <button className="settings-button" onClick={() => openModal('settings')}><Icon name="settings" size={18} /> Workspace settings<Icon name="chevron" size={14} /></button>
        <div className="connection">
          <span className={`status-dot ${health ? 'online' : ''}`} />
          {health ? 'Backend connected' : 'Backend unavailable'}
          <span>v0.1</span>
        </div>
      </div>
    </aside>
    <main id="main" className="workspace">
      <header className="topbar">
        <div>
          <span className="muted">Your library</span>
          <span className="breadcrumb-slash">/</span>
          <strong>{selected?.title || 'New adventure'}</strong>
        </div>
        <span className="private-label"><Icon name="compass" size={15} /> YOUR PERSONAL WALKTHROUGH</span>
      </header>
      {selected ? <GameWorkspace key={selected.id} game={selected} generationAvailable={!!health?.generation_configured} adminKey={adminKey} refresh={sourceRefresh} addSource={() => openModal('source')} /> : <div className="welcome empty-library">
        <div className="hero-emblem">
          <Icon name="compass" size={44} />
        </div>
        <span className="eyebrow">EVERY ADVENTURE NEEDS A WAYPOINT</span>
        <h1>Your next chapter<br />starts here.</h1>
        <p>Add a game and a walkthrough source.<br />Then ask a question and find your way forward.</p>
        <button className="primary" onClick={() => openModal('game')}><Icon name="plus" size={18} /> Add your first game</button>
      </div>}
    </main>
    {modal === 'game' && <Modal title="Add an adventure" close={() => !saving && setModal(null)}>
      <form onSubmit={submitGame} className="stack">
        <p className="muted small">Create a home for your walkthroughs and questions.</p>
        <label>Game title<input autoFocus required maxLength={200} value={gameTitle} placeholder="e.g. Elden Ring" onChange={e => {
            setGameTitle(e.target.value);
            if (!slugEdited) setGameSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
          }} /></label>
        <label>Game identifier<input required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={gameSlug} onChange={e => {
            setGameSlug(e.target.value);
            setSlugEdited(true);
          }} /><small>Unique name using lowercase letters, numbers, and hyphens.</small></label>
        {formError && <p className="error" role="alert">{formError}</p>}
        <button className="primary" disabled={saving}>
          {saving ? 'Creating…' : 'Add game'}
          <Icon name="plus" size={18} />
        </button>
      </form>
    </Modal>}
    {modal === 'source' && <Modal title="Add a walkthrough" close={() => !saving && setModal(null)}>
      <form onSubmit={submitSource} className="stack">
        <p className="muted small">Add a guide for <strong>{selected?.title}</strong>. Use sources you have permission to import.</p>
        <div className="segmented">
          <button type="button" aria-pressed={sourceMode === 'text'} className={sourceMode === 'text' ? 'chosen' : ''} onClick={() => setSourceMode('text')}>Paste guide text</button>
          <button type="button" aria-pressed={sourceMode === 'url'} className={sourceMode === 'url' ? 'chosen' : ''} onClick={() => setSourceMode('url')}>Import from URL</button>
        </div>
        <label>Guide title<input name="title" required maxLength={300} placeholder="e.g. Stormveil Castle walkthrough" /></label>
        <label>Source URL<input name="url" type="url" required placeholder="https://…" /></label>
        {sourceMode === 'text' ? <label>Walkthrough text<textarea name="text" required minLength={40} maxLength={500000} rows={6} placeholder="Paste the guide content here (at least 40 characters)…" /></label> : <p className="notice">URL imports require the host to be enabled in the backend allowlist. Use a direct HTTPS page; some sites block imports.</p>}
        <div className="form-row">
          <label>Platform <span className="muted">(optional)</span><input name="platform" maxLength={80} placeholder="e.g. PC" /></label>
          <label>Version <span className="muted">(optional)</span><input name="version" maxLength={80} placeholder="e.g. 1.0" /></label>
        </div>
        <p className="small muted">Adding the same source URL again replaces its existing content.</p>
        {formError && <p className="error" role="alert">{formError}</p>}
        <button className="primary" disabled={saving}>
          {saving ? 'Importing walkthrough…' : 'Add source'}
          <Icon name="book" size={18} />
        </button>
      </form>
    </Modal>}
    {modal === 'settings' && <Modal title="Workspace settings" close={() => setModal(null)}>
      <form className="stack" onSubmit={e => {
        e.preventDefault();
        setModal(null);
      }}>
        <label>Admin key<input type="password" autoComplete="off" value={adminKey} onChange={e => setAdminKey(e.target.value)} placeholder="Only if your backend requires one" /><small>Used to add games, import guides, and delete sources. Kept in memory for this tab only.</small></label>
        <div className="notice">Generated answers {health?.generation_configured ? 'are configured on your backend.' : 'need an Ollama model configured on your backend.'} Source passages are available without a model.</div>
        <button className="primary">Done<Icon name="check" size={18} /></button>
      </form>
    </Modal>}
  </div>;
}
function GameWorkspace({
  game,
  generationAvailable,
  adminKey,
  refresh,
  addSource
}: {
  game: Game;
  generationAvailable: boolean;
  adminKey: string;
  refresh: number;
  addSource: () => void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceError, setSourceError] = useState('');
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceTick, setSourceTick] = useState(0);
  const [question, setQuestion] = useState('');
  const [context, setContext] = useState('');
  const [platform, setPlatform] = useState('');
  const [version, setVersion] = useState('');
  const [mode, setMode] = useState<'extractive' | 'generate'>('extractive');
  const [options, setOptions] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const queryController = useRef<AbortController | null>(null);
  useEffect(() => () => queryController.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setSourcesLoading(true);
    setSourceError('');
    api<Source[]>(`/games/${game.id}/sources`, {
      signal: controller.signal
    }).then(setSources).catch(err => {
      if (!controller.signal.aborted) setSourceError(errorMessage(err));
    }).finally(() => {
      if (!controller.signal.aborted) setSourcesLoading(false);
    });
    return () => controller.abort();
  }, [game.id, refresh, sourceTick]);
  useEffect(() => {
    if (turns.length || pending) bottom.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end'
    });
  }, [turns.length, pending]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !question.trim() || !sources.length) return;
    const asked = question.trim();
    const controller = new AbortController();
    queryController.current = controller;
    setPending(true);
    setPendingQuestion(asked);
    setError('');
    try {
      const answer = await api<Answer>(`/games/${game.id}/query`, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          question: asked,
          context,
          platform: platform.trim() || null,
          version: version.trim() || null,
          mode
        })
      });
      setTurns(current => [...current, {
        id: Date.now(),
        question: asked,
        answer
      }]);
      setQuestion('');
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err));
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }
  async function deleteSource(source: Source) {
    setDeleting(source.id);
    setSourceError('');
    try {
      await api(`/games/${game.id}/sources/${source.id}`, {
        method: 'DELETE',
        headers: {
          'X-Admin-Key': adminKey
        }
      });
      setSources(current => current.filter(s => s.id !== source.id));
      setConfirmDelete(null);
    } catch (err) {
      setSourceError(errorMessage(err));
    } finally {
      setDeleting(null);
    }
  }
  async function copyTurn(turn: Turn) {
    try {
      await navigator.clipboard.writeText(turn.answer.answer + '\n\n' + turn.answer.citations.map(c => `[${c.number}] ${c.title}: ${c.url}`).join('\n'));
      setCopyState(turn.id);
    } catch {
      setError('Clipboard is unavailable. You can select and copy the answer text directly.');
    }
  }
  const ready = !sourcesLoading && sources.length > 0;
  return <div className="game-workspace">
    <section className="conversation">
      <div className="session-heading">
        <span className="session-label"><span className="status-dot online" /> WALKTHROUGH ASSISTANT</span>
        <button className="text-button" disabled={!turns.length || pending} onClick={() => {
          setTurns([]);
          setQuestion('');
          setContext('');
          setError('');
          setCopyState(null);
        }}>New session <Icon name="plus" size={14} /></button>
      </div>
      {!turns.length && !pending ? <div className="welcome">
        <div className="hero-emblem">
          <Icon name="compass" size={44} />
          <span className="orbit one" />
          <span className="orbit two" />
        </div>
        <span className="eyebrow">A LITTLE DIRECTION GOES A LONG WAY</span>
        <h1>Stay curious.<br /><span>Find your way forward.</span></h1>
        <p>Your companion for <strong>{game.title}</strong>.<br />Ask a question. Get guidance backed by your guides.</p>
        <div className="suggestions">{suggestions.map(s => <button key={s.title} onClick={() => {
            setQuestion(s.text);
            input.current?.focus();
          }}>
            <span className="suggestion-icon">
              <Icon name={s.icon} size={21} />
            </span>
            <strong>{s.title}</strong>
            <small>{s.hint}</small>
            <Icon name="chevron" size={14} />
          </button>)}</div>
        {!sourcesLoading && !sources.length && <div className="setup-hint">
          <Icon name="book" size={17} />
          <span>One more step: add a walkthrough to start asking questions.</span>
          <button className="text-button" onClick={addSource}>Add source ↗</button>
        </div>}
      </div> : <div className="turns">
        {turns.map(turn => <article className="turn" key={turn.id}>
          <div className="question-row">
            <span className="avatar">YOU</span>
            <h2>{turn.question}</h2>
          </div>
          <div className="answer-heading">
            <span className="mini-brand">
              <Icon name="compass" size={20} />
            </span>
            <strong>Waypoint</strong>
            <span className="answer-badge">{turn.answer.mode === 'generate' ? 'Synthesized guidance' : 'Source passages'}</span>
          </div>
          <div className="answer-text">{turn.answer.answer.split(/(\[\d+\])/).map((part, i) => {
              const number = /^\[(\d+)\]$/.exec(part)?.[1];
              return number && turn.answer.citations.some(c => c.number === Number(number)) ? <a key={i} className="inline-citation" onClick={() => {
                document.getElementById(`citation-${turn.id}-${number}`)?.closest("details")?.setAttribute("open", "");
              }} href={`#citation-${turn.id}-${number}`}>{number}</a> : <span key={i}>{part}</span>;
            })}</div>
          {turn.answer.status === 'insufficient_context' && <button className="text-button" onClick={addSource}>Add another walkthrough <Icon name="plus" size={15} /></button>}
          {turn.answer.citations.length > 0 && <details className="citations">
            <summary><Icon name="link" size={15} />{turn.answer.citations.length} supporting passage{turn.answer.citations.length === 1 ? '' : 's'}<span>View sources</span></summary>
            {turn.answer.citations.map(c => <div className="citation" id={`citation-${turn.id}-${c.number}`} key={c.chunk_id}>
              <a href={c.url} target="_blank" rel="noopener noreferrer">
                <span>[{c.number}] {c.title}</span>
                <Icon name="external" size={13} />
              </a>
              <p>{c.excerpt}</p>
            </div>)}
          </details>}
          <button className="text-button copy-button" onClick={() => void copyTurn(turn)}>
            <Icon name={copyState === turn.id ? 'check' : 'book'} size={13} />
            {copyState === turn.id ? 'Copied' : 'Copy answer'}
          </button>
        </article>)}
        {pending && <article className="turn">
          <div className="question-row">
            <span className="avatar">YOU</span>
            <h2>{pendingQuestion}</h2>
          </div>
          <div className="thinking" role="status">
            <span className="spinner" />
            {mode === 'generate' ? 'Reading your guides and putting the pieces together…' : 'Finding relevant passages in your guides…'}
          </div>
        </article>}
        <div ref={bottom} />
      </div>}
      <div className="composer-area">
        {error && <div className="error" role="alert">{error}</div>}
        <form className="composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="question">Ask about {game.title}</label>
          <textarea id="question" ref={input} value={question} disabled={pending} minLength={3} maxLength={2000} onChange={e => setQuestion(e.target.value)} placeholder={ready ? `Where are you stuck in ${game.title}?` : 'Add a walkthrough to begin your adventure…'} rows={2} onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }} />
          {options && <div className="query-options">
            <label>Current objective or location<textarea rows={2} maxLength={2000} value={context} onChange={e => setContext(e.target.value)} placeholder="Tell your guide where you are and what you have tried…" /></label>
            <div className="form-row">
              <label>Platform<input value={platform} maxLength={80} onChange={e => setPlatform(e.target.value)} placeholder="Any platform" /></label>
              <label>Game version<input value={version} maxLength={80} onChange={e => setVersion(e.target.value)} placeholder="Any version" /></label>
            </div>
            <small className="muted">Questions are independent. Include relevant details here for follow-up questions.</small>
          </div>}
          <div className="composer-toolbar">
            <select aria-label="Answer mode" value={mode} disabled={pending} onChange={e => setMode(e.target.value as typeof mode)}>
              <option value="extractive">◈ Source passages</option>
              <option value="generate" disabled={!generationAvailable}>✧ Generated guidance{!generationAvailable ? ' (unavailable)' : ''}</option>
            </select>
            <button type="button" className={`context-button ${options ? 'enabled' : ''}`} aria-expanded={options} onClick={() => setOptions(!options)}>
              <Icon name="settings" size={15} />
              <span>Context & filters</span>
            </button>
            <button className="send-button" aria-label="Send question" title="Send question" disabled={!ready || question.trim().length < 3 || pending}>{pending ? <span className="spinner" /> : <Icon name="arrow" size={20} />}</button>
          </div>
        </form>
        <p className="composer-footnote"><Icon name="link" size={12} /> Grounded in your sources. Guides may contain spoilers.</p>
      </div>
    </section>
    <aside className="source-panel">
      <div className="source-heading">
        <span className="eyebrow">THE KNOWLEDGE BEHIND IT</span>
        <h2>Your guidebook <span className="count">{sources.length.toString().padStart(2, '0')}</span></h2>
        <p>Good guidance starts with good sources.</p>
      </div>
      <div className="source-list" aria-busy={sourcesLoading}>{sourcesLoading ? <p className="small muted" role="status">Loading guides…</p> : sources.map(source => <div className="source-card" key={source.id}>
          <div className="source-card-top">
            <span className="source-icon">
              <Icon name="book" size={18} />
            </span>
            <span>WALKTHROUGH</span>
            <button className="icon-button delete-button" aria-label={`Delete ${source.title}`} onClick={() => setConfirmDelete(source.id)}>
              <Icon name="trash" size={14} />
            </button>
          </div>
          <a className="source-title" href={source.url} target="_blank" rel="noopener noreferrer">
            {source.title}
            <Icon name="external" size={12} />
          </a>
          <span className="source-host">{new URL(source.url).hostname}</span>
          <div className="source-meta"><span className="status-dot online" />{source.chunk_count} indexed passage{source.chunk_count === 1 ? '' : 's'}{source.platform && <span className="tag">{source.platform}</span>}{source.version && <span className="tag">v{source.version}</span>}</div>
          {confirmDelete === source.id && <div className="delete-confirm">
            <p>Remove this guide from future answers?</p>
            <button disabled={deleting !== null} onClick={() => void deleteSource(source)}>{deleting === source.id ? 'Removing…' : 'Remove'}</button>
            <button disabled={deleting !== null} onClick={() => setConfirmDelete(null)}>Keep guide</button>
          </div>}
        </div>)}{!sourcesLoading && !sources.length && <div className="empty-sources">
          <span className="source-icon">
            <Icon name="book" size={28} />
          </span>
          <h3>An unwritten guidebook</h3>
          <p>Add a walkthrough from a site you trust. Waypoint will use it to help you move forward.</p>
        </div>}</div>
      {sourceError && <div className="error" role="alert">
        {sourceError}
        <button className="text-button" onClick={() => setSourceTick(n => n + 1)}>Retry</button>
      </div>}
      <button className="add-source" onClick={addSource}><Icon name="plus" size={16} /> Add a source</button>
      <div className="source-note">
        <Icon name="shield" size={18} />
        <div>
          <strong>Follow the source</strong>
          <p>Every answer points back to its guides, so you can explore the details yourself.</p>
        </div>
      </div>
      <div className="map-decoration" aria-hidden="true">
        <div className="map-cross" />
        <Icon name="compass" size={42} />
        <span>THE ADVENTURE IS YOURS.</span>
      </div>
    </aside>
  </div>;
}
export default App;
