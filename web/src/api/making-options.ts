const ENGINE_API = import.meta.env.VITE_ENGINE_API_URL ?? '';

export interface MakingPathOptions {
  enginePaths: string[];
  bookPaths: string[];
}

async function parseError(res: Response): Promise<never> {
  let message = `making options api error ${res.status}`;
  try {
    const payload = await res.json();
    if (payload?.error) message = String(payload.error);
  } catch {
    const text = await res.text();
    if (text) message = text;
  }
  throw new Error(message);
}

export async function getMakingPathOptions(): Promise<MakingPathOptions> {
  const res = await fetch(`${ENGINE_API}/api/making-options`);
  if (!res.ok) return parseError(res);
  const payload = (await res.json()) as Partial<MakingPathOptions>;
  return {
    enginePaths: payload.enginePaths ?? [],
    bookPaths: payload.bookPaths ?? [],
  };
}
