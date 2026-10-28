export interface Game {
  id: string;
  title: string;
  slug: string;
}
export interface Source {
  id: string;
  title: string;
  url: string;
  platform: string | null;
  version: string | null;
  chunk_count: number;
}
export interface Citation {
  number: number;
  source_id: string;
  chunk_id: number;
  title: string;
  url: string;
  excerpt: string;
}
export interface Answer {
  answer: string;
  mode: 'extractive' | 'generate';
  status: 'answered' | 'insufficient_context';
  citations: Citation[];
}
export interface Health {
  status: string;
  generation_configured: boolean;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Cannot reach the backend. Make sure it is running on port 8000, then try again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = typeof body?.detail === 'string' ? body.detail : Array.isArray(body?.detail) ? body.detail.map((item: {
      loc: string[];
      msg: string;
    }) => `${item.loc.slice(1).join(' ')}: ${item.msg}`).join('. ') : `Request failed (${response.status}). Please try again.`;
    throw new Error(message);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
