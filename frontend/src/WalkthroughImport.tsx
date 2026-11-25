import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';

type Page = { url: string; title: string };
type Discovery = { pages: Page[]; scope: string; limit: number };
export function WalkthroughImport({ gameId, adminKey, onImported }: {
  gameId: string; adminKey: string; onImported: () => void;
}) {
  const [url, setUrl] = useState('');
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<{ url: string; message: string }[]>([]);
  const [platform, setPlatform] = useState('');
  const [version, setVersion] = useState('');
  const stopped = useRef(false);
  useEffect(() => () => { stopped.current = true; }, []);
  async function discover() {
    stopped.current = false;
    setBusy(true); setError(''); setDiscovery(null); setResults([]); setProgress('Finding linked pages…');
    try {
      const found = await api<Discovery>(`/games/${gameId}/walkthrough/discover`, {
        method: 'POST', headers: { 'X-Admin-Key': adminKey }, body: JSON.stringify({ url }),
      });
      if (stopped.current) return;
      setDiscovery(found); setSelected(found.pages.slice(0, 25).map(page => page.url)); setProgress('');
    } catch (err) { if (!stopped.current) setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  async function importPages() {
    if (!discovery) return;
    stopped.current = false;
    setBusy(true); setError(''); setResults([]);
    const pages = discovery.pages.filter(page => selected.includes(page.url));
    let completed = 0;
    try {
      for (const page of pages) {
        if (stopped.current) break;
        setProgress(`Importing ${completed + 1} of ${pages.length}: ${page.title}`);
        try {
          await api(`/games/${gameId}/sources`, {
            method: 'POST', headers: { 'X-Admin-Key': adminKey },
            body: JSON.stringify({ ...page, platform: platform || null, version: version || null }),
          });
          onImported();
          setResults(current => [...current, { url: page.url, message: 'Imported' }]);
        } catch (err) {
          setResults(current => [...current, { url: page.url, message: errorMessage(err) }]);
        }
        completed++;
        // Keep requests sequential and leave a pause between pages on the same host.
        if (completed < pages.length && !stopped.current) await new Promise(resolve => setTimeout(resolve, 1000));
      }
      setProgress(`${stopped.current ? 'Stopped' : 'Finished'}: ${completed} of ${pages.length} pages processed. See results below.`);
    } finally { setBusy(false); }
  }
  return <div className="stack">
    <p className="notice">Start with a walkthrough index. Review up to 100 linked pages within its section and select up to 25 to import. Keep this dialog open; closing it stops after the current request.</p>
    <label>Walkthrough index URL<input type="url" value={url} disabled={busy} onChange={event => { setUrl(event.target.value); setDiscovery(null); }} placeholder="https://www.ign.com/wikis/elden-ring/Walkthrough" /></label>
    <button className="primary" disabled={busy || !url} onClick={() => void discover()}>Find walkthrough pages</button>
    {discovery && <>
      <p className="small muted">Section: {discovery.scope}. Links may include optional topics; select the ones you want.</p>
      <div className="walkthrough-pages">
        {discovery.pages.map(page => <label key={page.url} className="walkthrough-page">
          <input type="checkbox" checked={selected.includes(page.url)} disabled={busy || (!selected.includes(page.url) && selected.length >= 25)} onChange={event => setSelected(current => event.target.checked ? [...current, page.url] : current.filter(value => value !== page.url))} />
          <span>{page.title}<a href={page.url} target="_blank" rel="noopener noreferrer">View page ↗</a></span>
        </label>)}
      </div>
      <div className="form-row">
        <label>Platform (optional)<input value={platform} maxLength={80} disabled={busy} onChange={event => setPlatform(event.target.value)} /></label>
        <label>Version (optional)<input value={version} maxLength={80} disabled={busy} onChange={event => setVersion(event.target.value)} /></label>
      </div>
      <button className="primary" disabled={busy || !selected.length} onClick={() => void importPages()}>Import {selected.length} selected pages</button>
    </>}
    {busy && <button className="text-button" onClick={() => { stopped.current = true; setProgress('Stopping after the current request…'); }}>Stop after current request</button>}
    {progress && <p role="status">{progress}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {!!results.length && <ul className="walkthrough-results">{results.map(result => <li key={result.url}><a href={result.url} target="_blank" rel="noopener noreferrer">{result.url}</a><span>{result.message}</span></li>)}</ul>}
  </div>;
}
