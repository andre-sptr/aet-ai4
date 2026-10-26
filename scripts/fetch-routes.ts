import { setTimeout as delay } from 'node:timers/promises';

/** A short API restart is retriable; invalid data and 4xx responses are not. */
export async function readPublicCollection(
  base: string,
  path: string,
  options: { fetcher?: typeof fetch; wait?: (milliseconds: number) => Promise<void> } = {},
): Promise<unknown> {
  const fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? delay;
  const deadline = Date.now() + 5_000;
  let lastError: unknown = new Error(`${path} could not be requested.`);
  for (let attempt = 0; attempt < 4; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let response: Response | undefined;
    try {
      response = await fetcher(`${base}${path}`, { signal: AbortSignal.timeout(Math.min(1_500, remaining)), redirect: 'manual' });
    } catch (error) {
      lastError = error;
    }
    if (response) {
      if (response.status < 500) {
        if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
        const text = await response.text();
        if (text.length > 5_000_000) throw new Error(`${path} exceeded the route synchronization response limit.`);
        return JSON.parse(text);
      }
      lastError = new Error(`${path} returned HTTP ${response.status}.`);
      await response.body?.cancel();
    }
    const pause = Math.min(125 * 2 ** attempt, deadline - Date.now());
    if (attempt < 3 && pause > 0) await wait(pause);
  }
  throw lastError;
}
