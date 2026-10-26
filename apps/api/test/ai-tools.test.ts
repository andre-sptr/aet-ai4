import test from 'node:test';
import assert from 'node:assert/strict';
import { arithmetic, publicAddress, validatePublicUrl, readPublicUrl, executeTool, planTools } from '../src/ai/tools.js';

test('arithmetic parser computes precedence/unary values and rejects executable/ambiguous input', () => {
  assert.equal(arithmetic('-(2 + 3) * 4 + 24 / 3'), -12);
  assert.equal(arithmetic('12 % 5'), 2);
  for (const invalid of ['process.exit()', '2 ** 10', 'Math.random()', '1/0', '2 3', '((1)', '2(3)', '1;fetch("https://x")']) assert.throws(() => arithmetic(invalid));
});
test('deterministic tools validate dimensions, bounded statistical input and formats', async () => {
  assert.match((await executeTool({ name: 'convert', args: { value: 2, from: 'km', to: 'm' } })).text, /2000/);
  await assert.rejects(executeTool({ name: 'convert', args: { value: 2, from: 'kg', to: 'm' } }), /Dimensi/);
  assert.match((await executeTool({ name: 'statistics', args: { values: [1, 2, 6] } })).text, /median: 2/);
  await assert.rejects(executeTool({ name: 'statistics', args: { values: [NaN] } }));
  assert.match((await executeTool({ name: 'format', args: { format: 'email', value: 'a@example.com' } })).text, /Keberadaan.*tidak diverifikasi/);
  const password = await executeTool({ name: 'password', args: { length: 24 } });
  assert.equal(password.text.match(/```text\n(.+)\n```/)?.[1]?.length, 24);
  await assert.rejects(executeTool({ name: 'password', args: { length: 2 } }));
  await assert.rejects(executeTool({ name: 'exec' as never, args: { code: '1' } }), /tidak diizinkan/);
});
test('tool planning respects explicit tool suppression and does not execute code examples', () => {
  assert.deepEqual(planTools('Jangan gunakan tool untuk hitung 2+2'), []);
  assert.deepEqual(planTools('```js\nfetch("https://example.com")\n```'), []);
  assert.equal(planTools('hitung 2+2')[0]?.name, 'arithmetic');
});
test('URL policy rejects private, local, mapped, metadata, unsafe port and credential targets', () => {
  for (const url of ['http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://10.0.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://example.com:444', 'https://user:pass@example.com', 'https://host.internal']) assert.throws(() => validatePublicUrl(url), url);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('100.64.0.1'), false);
  assert.equal(publicAddress('2001:db8::1'), false);
  assert.equal(validatePublicUrl('https://example.com/path').hostname, 'example.com');
});
test('reader validates every DNS answer, pins public address, and rechecks redirects', async () => {
  let transported = false;
  await assert.rejects(readPublicUrl('https://example.com', undefined, { resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], transport: async () => { transported = true; return { status: 200, mime: 'text/plain', body: 'bad' }; } }), /privat/);
  assert.equal(transported, false);
  const targets: string[] = [];
  const page = await readPublicUrl('https://example.com', undefined, { resolve: async () => [{ address: '8.8.8.8', family: 4 }], transport: async (url, address) => { targets.push(address.address); return { status: 200, mime: 'text/html', body: '<script>secret()</script><h1>Article</h1><p>Actual content</p>' }; } });
  assert.deepEqual(targets, ['8.8.8.8']);
  assert.match(page.text, /Article Actual content/);
  assert.doesNotMatch(page.text, /secret/);
  await assert.rejects(readPublicUrl('https://example.com', undefined, { resolve: async () => [{ address: '8.8.8.8', family: 4 }], transport: async () => ({ status: 302, location: 'https://169.254.169.254/latest', mime: 'text/plain', body: '' }) }), /HTTPS publik/);
});
test('missing optional search integration reports unavailable without invented sources or provider call', async () => {
  const old = process.env.TAVILY_API_KEY; delete process.env.TAVILY_API_KEY;
  try {
    const result = await executeTool({ name: 'search', args: { query: 'berita hari ini' } }, { fetcher: async () => { throw new Error('must not fetch without configured key'); } });
    assert.equal(result.available, false); assert.deepEqual(result.sources, []); assert.match(result.text, /tidak tersedia/);
  } finally { if (old === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = old; }
});

test('URL cancellation interrupts DNS wait before any transport call', async () => {
  const controller = new AbortController(); let resolveStarted = false, transported = false;
  const operation = readPublicUrl('https://example.com', controller.signal, {
    resolve: () => { resolveStarted = true; return new Promise(() => undefined); },
    transport: async () => { transported = true; return { status: 200, mime: 'text/plain', body: 'not expected' }; },
  });
  assert.equal(resolveStarted, true); controller.abort();
  await assert.rejects(operation, error => error instanceof Error && error.name === 'AbortError');
  assert.equal(transported, false);
});
