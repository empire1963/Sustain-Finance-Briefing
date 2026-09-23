import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../runtime/app.mjs';
import { configuration, createServices } from '../runtime/services.mjs';
import { parseFeed } from '../server/feed.mjs';
import { SOURCES } from '../server/sources.mjs';
import { defaults } from '../server/reader.mjs';

const NOW = Date.UTC(2026, 8, 22, 12);
const ORIGIN = 'https://sustain.example';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_server_only',
  SUSTAIN_ALLOWED_EMAILS: 'a@example.org, b@example.org',
};
const PUBLIC_ENV = { ...ENV, SUSTAIN_PUBLIC_NEWS: 'true' };
const preferences = { topics: ['ESG policy'], regions: ['Europe'], sort: 'newest', openBriefing: true };

function request(path, { method = 'GET', token = 'reader-a', body, rawBody, headers = {} } = {}) {
  return new Request(`${ORIGIN}/api/${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function assertPrivate(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('vary'), /Authorization/i);
  return response;
}

function snapshot(now = NOW, slug = 'climate-fund') {
  const source = SOURCES[0];
  const articles = parseFeed(`<rss><channel><item><title>Climate fund raises $2 billion</title><link>https://www.esgtoday.com/${slug}</link><pubDate>${new Date(now).toUTCString()}</pubDate><description>Climate investment supports renewable energy.</description></item></channel></rss>`, source, now).articles;
  assert.equal(articles.length, 1);
  return {
    rows: [{ source_id: source.id, articles, checked_at: now, fetched_at: now, error: null }],
    collector: { last_started: now, last_finished: now, last_error: null, run_count: 1, successful_sources: 1, total_sources: SOURCES.length },
  };
}

function fixture(overrides = {}) {
  const calls = [], saved = new Map(), prefs = new Map();
  const users = {
    'reader-a': { id: USER_A, email: 'A@example.org', email_confirmed_at: '2026-01-01' },
    'reader-b': { id: USER_B, email: 'b@example.org', email_confirmed_at: '2026-01-01' },
    unverified: { id: USER_A, email: 'a@example.org', email_confirmed_at: null },
    outsider: { id: USER_B, email: 'outsider@example.org', email_confirmed_at: '2026-01-01' },
  };
  const services = {
    async user(token) { return users[token] || null; },
    async snapshot() { calls.push(['snapshot']); return snapshot(); },
    async reader(id) { calls.push(['reader', id]); return { preferences: prefs.get(id), saved: [...(saved.get(id)?.values() || [])] }; },
    async preferences(id, value) { calls.push(['preferences', id]); prefs.set(id, value); return value; },
    async save(id, url, article, savedAt) {
      calls.push(['save', id, url]);
      if (!saved.has(id)) saved.set(id, new Map());
      const result = { ...article, savedAt: saved.get(id).get(url)?.savedAt || savedAt };
      saved.get(id).set(url, result);
      return result;
    },
    async remove(id, url) { calls.push(['remove', id, url]); saved.get(id)?.delete(url); },
    ...overrides,
  };
  return { services, calls, saved, prefs };
}

test('Vercel public configuration exposes only the publishable key and rejects secret public keys', async () => {
  const app = createApp({ env: ENV });
  const response = assertPrivate(await app(request('config', { token: null })), 200);
  assert.deepEqual(await response.json(), {
    supabaseUrl: ENV.SUPABASE_URL,
    supabasePublishableKey: ENV.SUPABASE_PUBLISHABLE_KEY,
    publicNews: false,
  });
  for (const env of [{}, { ...ENV, SUPABASE_URL: '' }, { ...ENV, SUPABASE_PUBLISHABLE_KEY: '' }]) {
    assertPrivate(await createApp({ env })(request('config', { token: null })), 503);
  }
  const jwt = role => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.equal(configuration({ ...ENV, SUPABASE_PUBLISHABLE_KEY: jwt('anon') }).publishable, jwt('anon'));
  for (const key of ['sb_secret_do_not_publish', jwt('service_role')]) {
    assert.throws(() => configuration({ ...ENV, SUPABASE_PUBLISHABLE_KEY: key }));
  }
  assert.throws(() => configuration({ ...ENV, SUPABASE_URL: 'http://remote.example' }));
});

test('Vercel authentication rejects forged identities, invalid tokens, unverified email and outsiders before data access', async () => {
  const { services, calls } = fixture();
  const app = createApp({ env: ENV, services });
  for (const [options, status] of [
    [{ token: null, headers: { 'oai-authenticated-user-id': USER_A } }, 401],
    [{ token: null, headers: { Authorization: 'Basic reader-a' } }, 401],
    [{ token: 'forged.jwt.signature' }, 401],
    [{ token: 'unverified' }, 401],
    [{ token: 'outsider' }, 403],
  ]) {
    for (const path of ['me', 'news']) assertPrivate(await app(request(path, options)), status);
  }
  assert.deepEqual(calls, []);
  const closed = createApp({ env: { ...ENV, SUSTAIN_ALLOWED_EMAILS: '' }, services });
  assertPrivate(await closed(request('news')), 403);
  assertPrivate(await closed(request('me')), 403);
  assert.deepEqual(calls, []);
});

test('explicit public-news mode still requires a verified identity for personal data and changes', async () => {
  const { services } = fixture();
  const app = createApp({ env: PUBLIC_ENV, services, clock: () => NOW });
  const news = await assertPrivate(await app(request('news', { token: null })), 200).json();
  assert.equal(news.articles.length, 1);
  assertPrivate(await app(request('me', { token: null })), 401);
  assertPrivate(await app(request('preferences', { token: null, method: 'PUT', body: preferences })), 401);
  assertPrivate(await app(request('saved', { token: 'unverified', method: 'DELETE', body: { url: news.articles[0].url } })), 401);
});

test('preferences use the verified identity and remain isolated between readers', async () => {
  const { services, calls } = fixture();
  const app = createApp({ env: ENV, services });
  assertPrivate(await app(request('preferences', { method: 'PUT', body: { ...preferences, userId: USER_B } })), 400);
  assertPrivate(await app(request('preferences', { method: 'PUT', body: { ...preferences, topics: ['arbitrary'] } })), 400);
  assertPrivate(await app(request('preferences', { method: 'PUT', body: preferences })), 200);
  const a = await assertPrivate(await app(request('me')), 200).json();
  const b = await assertPrivate(await app(request('me', { token: 'reader-b' })), 200).json();
  assert.deepEqual(a.preferences, preferences);
  assert.deepEqual(b.preferences, defaults());
  assert.deepEqual(calls.filter(call => call[0] === 'preferences'), [['preferences', USER_A]]);
});

test('saved stories come from the feed and reader B cannot remove reader A stories', async () => {
  const { services, calls } = fixture();
  const app = createApp({ env: ENV, services, clock: () => NOW });
  const url = snapshot().rows[0].articles[0].url;
  assertPrivate(await app(request('saved', { method: 'POST', body: { url: 'https://evil.example/invented' } })), 404);
  assertPrivate(await app(request('saved', { method: 'POST', body: { url, userId: USER_B } })), 400);
  assertPrivate(await app(request('saved', { method: 'POST', body: { url, payload: { headline: 'Forged' } } })), 400);
  const saved = await assertPrivate(await app(request('saved', { method: 'POST', body: { url } })), 200).json();
  assert.equal(saved.article.url, url);
  assert.equal(saved.article.headline, 'Climate fund raises $2 billion');
  assert.equal(saved.article.savedAt, NOW);
  assertPrivate(await app(request('saved', { token: 'reader-b', method: 'DELETE', body: { url } })), 200);
  assert.equal((await assertPrivate(await app(request('me')), 200).json()).saved.length, 1);
  assert.deepEqual((await assertPrivate(await app(request('me', { token: 'reader-b' })), 200).json()).saved, []);
  assertPrivate(await app(request('saved', { method: 'DELETE', body: { url } })), 200);
  assert.deepEqual((await assertPrivate(await app(request('me')), 200).json()).saved, []);
  assert.deepEqual(calls.filter(call => call[0] === 'save'), [['save', USER_A, url]]);
  assert.deepEqual(calls.filter(call => call[0] === 'remove'), [['remove', USER_B, url], ['remove', USER_A, url]]);
});

test('write validation rejects foreign origins, incorrect media types and oversized bodies before storage', async () => {
  const { services, calls } = fixture();
  const app = createApp({ env: ENV, services });
  for (const [options, status] of [
    [{ body: preferences, headers: { Origin: 'https://evil.example' } }, 403],
    [{ body: preferences, headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
    [{ body: preferences, headers: { 'Content-Type': 'text/plain' } }, 415],
    [{ rawBody: '{broken' }, 400],
    [{}, 400],
    [{ body: preferences, headers: { 'Content-Length': '4097' } }, 413],
    [{ rawBody: JSON.stringify({ data: 'x'.repeat(5000) }) }, 413],
  ]) {
    assertPrivate(await app(request('preferences', { method: 'PUT', ...options })), status);
  }
  assert.deepEqual(calls, []);
});

test('routing and storage failures return uncached JSON without exposing internal errors', async () => {
  const { services } = fixture({ async reader() { throw new Error('database_password=never_expose'); } });
  const app = createApp({ env: ENV, services });
  assertPrivate(await app(request('unknown')), 404);
  const method = assertPrivate(await app(request('me', { method: 'POST' })), 405);
  assert.equal(method.headers.get('allow'), 'GET');
  const failed = assertPrivate(await app(request('me')), 503);
  assert.doesNotMatch(await failed.text(), /database_password|never_expose|sb_secret/);
  const limit = createApp({ env: ENV, clock: () => NOW, services: fixture({ async save() { throw { code: 'P0001', message: 'saved_story_limit' }; } }).services });
  const result = assertPrivate(await limit(request('saved', { method: 'POST', body: { url: snapshot().rows[0].articles[0].url } })), 409);
  assert.match((await result.json()).error, /500 stories/);
  const expired = createApp({ env: ENV, clock: () => NOW, services: fixture({ async save() { throw { code: 'P0002', message: 'story_not_in_feed' }; } }).services });
  assertPrivate(await expired(request('saved', { method: 'POST', body: { url: snapshot().rows[0].articles[0].url } })), 404);
});

test('cloud snapshot requests keep the reader token server-side and do not follow redirects', async () => {
  let reads = 0, fallback = 0;
  const env = { ...PUBLIC_ENV, SUSTAIN_CLOUD_URL: 'https://collector.example/snapshot', SUSTAIN_CLOUD_READ_TOKEN: 'private-reader-token' };
  const app = createApp({
    env, clock: () => NOW,
    services: fixture({ async snapshot() { fallback++; throw new Error('Unexpected fallback'); } }).services,
    fetcher: async (url, options) => {
      reads++;
      assert.equal(String(url), env.SUSTAIN_CLOUD_URL);
      assert.equal(options.headers['X-Sustain-Reader'], env.SUSTAIN_CLOUD_READ_TOKEN);
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(snapshot());
    },
  });
  const result = await assertPrivate(await app(request('news', { token: null })), 200).text();
  assert.match(result, /climate-fund/);
  assert.doesNotMatch(result, /private-reader-token|sb_secret/);
  assert.equal(reads, 1);
  assert.equal(fallback, 0);
});

test('concurrent news requests share the collection and reuse the snapshot until its refresh interval', async () => {
  let time = NOW, reads = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const app = createApp({ env: PUBLIC_ENV, clock: () => time, services: fixture({ async snapshot() { reads++; await gate; return snapshot(time, `revision-${reads}`); } }).services });
  const first = app(request('news', { token: null }));
  const second = app(request('news', { token: null }));
  release();
  const a = await assertPrivate(await first, 200).json();
  const b = await assertPrivate(await second, 200).json();
  assert.deepEqual(a.articles, b.articles);
  assert.equal(reads, 1);
  time += 59999;
  const cached = await assertPrivate(await app(request('news', { token: null })), 200).json();
  assert.equal(cached.articles[0].url, a.articles[0].url);
  assert.equal(reads, 1);
  time++;
  const fresh = await assertPrivate(await app(request('news', { token: null })), 200).json();
  assert.match(fresh.articles[0].url, /revision-2$/);
  assert.equal(reads, 2);
});

test('a cold collector failure returns 503 and waits fifteen seconds before retrying', async () => {
  let time = NOW, reads = 0;
  const app = createApp({ env: PUBLIC_ENV, clock: () => time, services: fixture({ async snapshot() { if (++reads === 1) throw new Error('Offline'); return snapshot(time); } }).services });
  assertPrivate(await app(request('news', { token: null })), 503);
  assertPrivate(await app(request('news', { token: null })), 503);
  time += 14999;
  assertPrivate(await app(request('news', { token: null })), 503);
  assert.equal(reads, 1);
  time++;
  const recovered = await assertPrivate(await app(request('news', { token: null })), 200).json();
  assert.equal(recovered.collector.status, 'ok');
  assert.equal(reads, 2);
});

test('a warm collector failure retains prior stories, reports unavailable and recovers after backoff', async () => {
  let time = NOW, reads = 0;
  const app = createApp({ env: PUBLIC_ENV, clock: () => time, services: fixture({ async snapshot() { if (++reads === 2) throw new Error('Offline'); return snapshot(time, `revision-${reads}`); } }).services });
  const first = await assertPrivate(await app(request('news', { token: null })), 200).json();
  time += 60000;
  const failed = await assertPrivate(await app(request('news', { token: null })), 200).json();
  const storyContent = articles => articles.map(({ url, headline, summary, published }) => ({ url, headline, summary, published }));
  assert.deepEqual(storyContent(failed.articles), storyContent(first.articles));
  assert.equal(failed.collector.status, 'unavailable');
  assert.equal(failed.collector.lastRunAt, first.collector.lastRunAt);
  time += 14999;
  assertPrivate(await app(request('news', { token: null })), 200);
  assert.equal(reads, 2);
  time++;
  const recovered = await assertPrivate(await app(request('news', { token: null })), 200).json();
  assert.equal(recovered.collector.status, 'ok');
  assert.match(recovered.articles[0].url, /revision-3$/);
});

test('redirects and malformed cloud snapshots fall back to the durable database snapshot', async () => {
  for (const response of [new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }), Response.json({ rows: [], collector: { last_finished: 'invented' } })]) {
    let reads = 0, fallback = 0;
    const app = createApp({
      env: { ...PUBLIC_ENV, SUSTAIN_CLOUD_URL: 'https://collector.example/snapshot', SUSTAIN_CLOUD_READ_TOKEN: 'read-only' },
      clock: () => NOW,
      services: fixture({ async snapshot() { fallback++; return snapshot(); } }).services,
      fetcher: async () => { reads++; return response; },
    });
    const data = await assertPrivate(await app(request('news', { token: null })), 200).json();
    assert.equal(data.collector.status, 'ok');
    assert.equal(data.articles.length, 1);
    assert.equal(fallback, 1);
    assert.equal(reads, 1);
  }
});

test('oversized cloud responses are cancelled before full consumption and use database fallback', async () => {
  let chunks = 0, cancelled = false, fallback = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (chunks === 12) return controller.close();
      chunks++;
      controller.enqueue(new Uint8Array(1000000).fill(32));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const app = createApp({
    env: { ...PUBLIC_ENV, SUSTAIN_CLOUD_URL: 'https://collector.example/snapshot', SUSTAIN_CLOUD_READ_TOKEN: 'read-only' },
    clock: () => NOW,
    services: fixture({ async snapshot() { fallback++; return snapshot(); } }).services,
    fetcher: async () => new Response(stream),
  });
  const data = await assertPrivate(await app(request('news', { token: null })), 200).json();
  assert.equal(data.articles.length, 1);
  assert.equal(fallback, 1);
  assert.equal(cancelled, true, 'The upstream body must be cancelled when its byte limit is exceeded');
  assert.ok(chunks < 12, 'The body limit must stop reading instead of checking after response.text()');
});

test('production Supabase services verify bearer tokens and scope every reader operation', async () => {
  const calls = [];
  const article = snapshot().rows[0].articles[0];
  const services = createServices(configuration(ENV), async (input, options = {}) => {
    const url = new URL(input), headers = new Headers(options.headers), method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, headers, method, body });
    assert.ok(options.signal instanceof AbortSignal);
    if (url.pathname === '/auth/v1/user') {
      assert.equal(headers.get('apikey'), ENV.SUPABASE_PUBLISHABLE_KEY);
      if (headers.get('authorization') !== 'Bearer valid-token') return Response.json({ message: 'Invalid token' }, { status: 401 });
      return Response.json({ id: USER_A, email: 'a@example.org', email_confirmed_at: '2026-01-01' });
    }
    assert.equal(headers.get('apikey'), ENV.SUPABASE_SECRET_KEY);
    if (url.pathname.endsWith('/sustain_reader_preferences') && method === 'GET') return Response.json([{ preferences }]);
    if (url.pathname.endsWith('/sustain_saved_stories') && method === 'GET') return Response.json([{ payload: article, saved_at: String(NOW) }]);
    if (url.pathname.endsWith('/rpc/sustain_save_story')) return Response.json([{ payload: body.p_payload, saved_at: body.p_saved_at }]);
    if (url.pathname.endsWith('/sustain_sources')) return Response.json(snapshot().rows);
    if (url.pathname.endsWith('/sustain_collector')) return Response.json(snapshot().collector);
    return new Response(null, { status: 204 });
  });
  assert.equal((await services.user('valid-token')).id, USER_A);
  assert.equal(await services.user('forged-token'), null);
  const reader = await services.reader(USER_A);
  assert.deepEqual(reader.preferences, preferences);
  assert.equal(reader.saved[0].savedAt, NOW);
  assert.deepEqual(await services.preferences(USER_A, preferences), preferences);
  assert.equal((await services.save(USER_A, article.url, article, NOW)).savedAt, NOW);
  await services.remove(USER_B, article.url);
  assert.equal((await services.snapshot()).rows.length, 1);

  const personalReads = calls.filter(call => call.method === 'GET' && /sustain_reader_preferences$|sustain_saved_stories$/.test(call.url.pathname));
  assert.equal(personalReads.length, 2);
  for (const call of personalReads) assert.equal(call.url.searchParams.get('user_id'), `eq.${USER_A}`);
  const savedRead = personalReads.find(call => call.url.pathname.endsWith('/sustain_saved_stories'));
  assert.equal(savedRead.url.searchParams.get('limit'), '500');
  assert.equal(savedRead.url.searchParams.get('order'), 'saved_at.desc');
  const upsert = calls.find(call => call.method === 'POST' && call.url.pathname.endsWith('/sustain_reader_preferences'));
  assert.equal(upsert.body.user_id, USER_A);
  assert.deepEqual(upsert.body.preferences, preferences);
  assert.equal(upsert.url.searchParams.get('on_conflict'), 'user_id');
  const save = calls.find(call => call.url.pathname.endsWith('/rpc/sustain_save_story'));
  assert.equal(save.body.p_user_id, USER_A);
  assert.equal(save.body.p_url, article.url);
  assert.deepEqual(save.body.p_payload, article);
  const deletion = calls.find(call => call.method === 'DELETE');
  assert.equal(deletion.url.searchParams.get('user_id'), `eq.${USER_B}`);
  assert.equal(deletion.url.searchParams.get('article_url'), `eq.${article.url}`);
});

test('missing server database key fails closed without sending a database request', async () => {
  let requests = 0;
  const services = createServices(configuration({ ...ENV, SUPABASE_SECRET_KEY: '' }), async () => { requests++; throw new Error('Unexpected network'); });
  await assert.rejects(services.reader(USER_A), { status: 503 });
  await assert.rejects(services.snapshot(), { status: 503 });
  await assert.rejects(services.preferences(USER_A, preferences), { status: 503 });
  assert.equal(requests, 0);
});

test('all five Vercel entrypoints export the native fetch handler', async () => {
  for (const route of ['config', 'news', 'me', 'preferences', 'saved']) {
    const entrypoint = await import(`../api/${route}.js`);
    assert.equal(typeof entrypoint.default.fetch, 'function');
  }
});
