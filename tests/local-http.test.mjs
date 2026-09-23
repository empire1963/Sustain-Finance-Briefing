import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFeed } from '../server/feed.mjs';
import { SOURCES } from '../server/sources.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const PUBLISHABLE = 'sb_publishable_loopback_fixture';
const SECRET = 'sb_secret_loopback_fixture';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

test('local HTTP server adapts real requests through Supabase Auth and scoped database operations', { timeout: 15000 }, async t => {
  const now = Date.now(), prefs = new Map(), saved = new Map(), calls = [], mockErrors = [];
  const source = SOURCES[0], articleUrl = 'https://www.esgtoday.com/http-fixture';
  const articles = parseFeed(`<rss><channel><item><title>Climate fund raises $2 billion</title><link>${articleUrl}</link><description>Investment supports renewable energy.</description></item></channel></rss>`, source, now).articles;
  assert.equal(articles.length, 1);

  const mockSupabase = createServer(async (req, res) => {
    const send = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(status === 204 ? undefined : JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text ? JSON.parse(text) : null;
      calls.push({ path: url.pathname, method: req.method, query: url.searchParams, body });
      if (url.pathname === '/auth/v1/user') {
        assert.equal(req.headers.apikey, PUBLISHABLE);
        const users = {
          'Bearer reader-a': { id: USER_A, email: 'a@example.org', email_confirmed_at: '2026-01-01' },
          'Bearer reader-b': { id: USER_B, email: 'b@example.org', email_confirmed_at: '2026-01-01' },
        };
        return users[req.headers.authorization]
          ? send(users[req.headers.authorization])
          : send({ message: 'Invalid token' }, 401);
      }
      assert.equal(req.headers.apikey, SECRET);
      if (url.pathname === '/rest/v1/sustain_sources') {
        return send([{ source_id: source.id, articles, checked_at: now, fetched_at: now, error: null }]);
      }
      if (url.pathname === '/rest/v1/sustain_collector') {
        assert.equal(url.searchParams.get('id'), 'eq.true');
        return send({ last_started: now, last_finished: now, last_error: null, run_count: 1, successful_sources: 1, total_sources: SOURCES.length });
      }
      if (url.pathname === '/rest/v1/rpc/sustain_save_story') {
        assert.equal(req.method, 'POST');
        assert.equal(body.p_user_id, USER_A);
        assert.equal(body.p_url, articleUrl);
        assert.equal(body.p_payload.url, articleUrl);
        const key = `${body.p_user_id}|${body.p_url}`;
        const row = { payload: body.p_payload, saved_at: saved.get(key)?.saved_at || body.p_saved_at };
        saved.set(key, row);
        return send([row]);
      }
      if (url.pathname === '/rest/v1/sustain_reader_preferences' && req.method === 'POST') {
        assert.equal(body.user_id, USER_A);
        assert.equal(url.searchParams.get('on_conflict'), 'user_id');
        prefs.set(body.user_id, body.preferences);
        return send(null, 204);
      }
      const id = url.searchParams.get('user_id')?.replace(/^eq\./, '');
      assert.ok([USER_A, USER_B].includes(id), 'Every personal database query must include its reader');
      if (url.pathname === '/rest/v1/sustain_reader_preferences' && req.method === 'GET') {
        return send(prefs.has(id) ? [{ preferences: prefs.get(id) }] : []);
      }
      if (url.pathname === '/rest/v1/sustain_saved_stories' && req.method === 'GET') {
        assert.equal(url.searchParams.get('limit'), '500');
        return send([...saved].filter(([key]) => key.startsWith(`${id}|`)).map(([, row]) => row));
      }
      if (url.pathname === '/rest/v1/sustain_saved_stories' && req.method === 'DELETE') {
        const target = url.searchParams.get('article_url');
        assert.equal(target, `eq.${articleUrl}`);
        saved.delete(`${id}|${target.slice(3)}`);
        return send(null, 204);
      }
      throw new Error(`Unexpected mock endpoint: ${req.method} ${url.pathname}`);
    } catch (error) {
      mockErrors.push(error);
      send({ message: error.message }, 500);
    }
  });
  const mockPort = await listen(mockSupabase);
  t.after(() => close(mockSupabase));

  // Reserve a free port because the development script logs the configured port.
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/dev-vercel.mjs'], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
      SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      SUPABASE_SECRET_KEY: SECRET,
      SUSTAIN_ALLOWED_EMAILS: 'a@example.org,b@example.org',
      SUSTAIN_PUBLIC_NEWS: 'false',
      SUSTAIN_CLOUD_URL: '',
      SUSTAIN_CLOUD_READ_TOKEN: '',
    },
  });
  let output = '';
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
  const exited = new Promise(resolve => child.once('close', resolve));
  t.after(async () => { child.kill(); await exited; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Development server did not start: ${output}`)), 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Development server exited ${code}: ${output}`)); });
    child.stdout.on('data', chunk => {
      output = (output + chunk).slice(-4000);
      if (output.includes(`Local: ${origin}/`)) { clearTimeout(timer); resolve(); }
    });
  });

  async function api(path, { method = 'GET', token = 'reader-a', body, status = 200, headers = {} } = {}) {
    const response = await fetch(`${origin}/api/${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: origin, 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(3000),
    });
    const text = await response.text();
    assert.equal(response.status, status, text);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
    assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store');
    assert.doesNotMatch(text, new RegExp(SECRET));
    return JSON.parse(text);
  }

  const config = await api('config', { token: null });
  assert.equal(config.supabaseUrl, `http://127.0.0.1:${mockPort}`);
  assert.equal(config.supabasePublishableKey, PUBLISHABLE);
  assert.equal(config.publicNews, false);
  await api('news', { token: null, status: 401 });
  await api('me', { token: null, headers: { 'oai-authenticated-user-id': USER_A }, status: 401 });
  await api('me', { token: 'forged-token', status: 401 });
  assert.equal((await api('me')).saved.length, 0);
  const news = await api('news');
  assert.equal(news.articles[0].url, articleUrl);
  assert.equal(news.collector.status, 'ok');

  const preferences = { topics: ['ESG policy'], regions: ['Europe'], sort: 'newest', openBriefing: true };
  await api('preferences', { method: 'PUT', body: preferences, headers: { Origin: 'https://evil.example' }, status: 403 });
  assert.equal(prefs.size, 0);
  await api('preferences', { method: 'PUT', body: preferences });
  assert.deepEqual((await api('me')).preferences, preferences);
  assert.equal((await api('me', { token: 'reader-b' })).preferences.openBriefing, false);

  const first = await api('saved', { method: 'POST', body: { url: articleUrl } });
  const again = await api('saved', { method: 'POST', body: { url: articleUrl } });
  assert.equal(again.article.savedAt, first.article.savedAt);
  assert.equal(saved.size, 1);
  assert.equal((await api('me')).saved[0].headline, news.articles[0].headline);
  assert.deepEqual((await api('me', { token: 'reader-b' })).saved, []);
  await api('saved', { token: 'reader-b', method: 'DELETE', body: { url: articleUrl } });
  assert.equal((await api('me')).saved.length, 1);
  await api('saved', { method: 'DELETE', body: { url: articleUrl } });
  assert.deepEqual((await api('me')).saved, []);
  assert.equal(calls.filter(call => call.path === '/rest/v1/sustain_sources').length, 1);
  assert.equal(calls.filter(call => call.path === '/rest/v1/rpc/sustain_save_story').length, 2);
  assert.deepEqual(mockErrors, []);
});
