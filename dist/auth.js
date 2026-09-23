import { createClient } from '@supabase/supabase-js';

export class StaleSessionError extends Error {
  constructor() { super('The signed-in account changed.'); this.name = 'StaleSessionError'; }
}

export class AccessError extends Error {
  constructor(message, status) { super(message); this.name = 'AccessError'; this.status = status; }
}

// The browser session supplies credentials only. The API independently verifies
// every token and decides which account is allowed to read or change each record.
export function createReaderAuth({
  clientFactory = createClient, fetchImpl = (...args) => fetch(...args),
  onChange = () => {}, clock = Date.now, schedule = setTimeout, cancel = clearTimeout,
  origin = window.location.origin,
} = {}) {
  let client = null, subscription = null, session = null, config = null;
  let status = 'loading', error = '', epoch = 0, expiryTimer = null, initializing = null;
  let authEvent = 0, signingOut = false;
  const requests = new Set();
  const snapshot = () => ({status, error, epoch, user: session?.user || null, publicNews: config?.publicNews === true, configured: !!client});
  const emit = event => onChange(snapshot(), event);
  const current = version => { if (version !== epoch) throw new StaleSessionError(); };
  function invalidate() {
    epoch += 1;
    for (const controller of requests) controller.abort();
    requests.clear();
  }
  function acceptSession(next, event, message = '') {
    if (signingOut && event !== 'SIGNED_OUT') return;
    const valid = next?.access_token && next?.user?.id && (!next.expires_at || next.expires_at * 1000 > clock());
    next = valid ? next : null;
    if ((next?.user.id || null) !== (session?.user.id || null)) invalidate();
    session = next;
    status = session ? 'signed_in' : message ? 'expired' : 'signed_out';
    error = message;
    if (expiryTimer !== null) cancel(expiryTimer);
    expiryTimer = null;
    if (session?.expires_at) {
      const token = session.access_token;
      expiryTimer = schedule(() => {
        if (session?.access_token === token) acceptSession(null, 'SESSION_EXPIRED', 'Your session has expired. Sign in again to continue.');
      }, Math.max(0, session.expires_at * 1000 - clock()));
    }
    emit(event);
  }
  async function initialize() {
    if (initializing) return initializing;
    if (client) return snapshot();
    status = 'loading'; error = ''; emit('LOADING');
    initializing = (async () => {
      try {
        const response = await fetchImpl('/api/config', {cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000)});
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.supabaseUrl || !data.supabasePublishableKey) throw new Error('Sign-in is temporarily unavailable. Please try again shortly.');
        config = {publicNews: data.publicNews === true};
        client = clientFactory(data.supabaseUrl, data.supabasePublishableKey, {
          auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
        });
        subscription = client.auth.onAuthStateChange((event, next) => {
          authEvent += 1;
          acceptSession(next, event);
        }).data.subscription;
        const initialEvent = authEvent;
        const result = await client.auth.getSession();
        // Do not overwrite a recovery callback or another tab's newer session.
        if (authEvent !== initialEvent) return snapshot();
        if (result.error) throw result.error;
        acceptSession(result.data.session, 'INITIAL_SESSION');
      } catch (cause) {
        if (client) {
          acceptSession(null, 'SESSION_ERROR', 'Your session could not be restored. Sign in again to continue.');
        } else {
          config = null; status = 'unavailable'; error = 'Sign-in is temporarily unavailable. Please try again shortly.';
          emit('CONFIG_ERROR');
        }
      } finally { initializing = null; }
      return snapshot();
    })();
    return initializing;
  }
  async function request(path, {method = 'GET', body, timeout = 20000, requireAuth = true} = {}) {
    const version = epoch;
    if (!client) throw new AccessError(error || 'Sign-in is not available yet.', 503);
    if (signingOut && requireAuth) throw new AccessError('Finish signing out before continuing.', 401);
    if (session) {
      const result = await client.auth.getSession();
      current(version);
      if (result.error || !result.data.session) {
        acceptSession(null, 'SESSION_EXPIRED', 'Your session has expired. Sign in again to continue.');
        throw new AccessError('Your session has expired. Sign in again to continue.', 401);
      }
      // getSession may refresh credentials without emitting an event in a mock
      // or a future SDK; still never use a different account for an old action.
      if (result.data.session.user.id !== session.user.id) throw new StaleSessionError();
      if (session.access_token !== result.data.session.access_token) acceptSession(result.data.session, 'TOKEN_REFRESHED');
    }
    if (requireAuth && !session) throw new AccessError('Sign in to access your reading room.', 401);
    let token = session?.access_token;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      current(version);
      const controller = new AbortController();
      const timer = schedule(() => controller.abort(), timeout);
      requests.add(controller);
      try {
        const headers = {};
        if (token) headers.Authorization = 'Bearer ' + token;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetchImpl(path, {method, cache: 'no-store', credentials: 'omit', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal});
        const data = await response.json().catch(() => ({}));
        current(version);
        if (response.status === 401 && token && attempt === 0) {
          // A refresh can race the API request. Retry once with the current
          // token; rejected credentials never create an automatic retry loop.
          const refreshed = session?.access_token !== token
            ? {data: {session}, error: null}
            : await client.auth.refreshSession().catch(cause => ({data: {session: null}, error: cause}));
          current(version);
          if (!refreshed.error && refreshed.data.session?.user.id === session?.user.id) {
            acceptSession(refreshed.data.session, 'TOKEN_REFRESHED');
            token = refreshed.data.session.access_token;
            continue;
          }
        }
        if (response.status === 401) {
          acceptSession(null, 'SESSION_EXPIRED', 'Your session has expired or is no longer valid. Sign in again to continue.');
          throw new AccessError('Sign in again to continue.', 401);
        }
        if (response.status === 403) throw new AccessError('This account does not have access. Sign in with an account approved by the site owner.', 403);
        if (!response.ok) throw new AccessError(typeof data.error === 'string' ? data.error : 'The service is temporarily unavailable. Please try again.', response.status);
        return data;
      } catch (cause) {
        if (cause instanceof AccessError) throw cause;
        current(version);
        throw cause;
      } finally {
        cancel(timer); requests.delete(controller);
      }
    }
  }
  function readyClient() {
    if (!client) throw new Error('Sign-in is temporarily unavailable. Please try again shortly.');
    if (signingOut) throw new Error('Finish signing out before signing in again.');
    return client;
  }
  async function signIn(email, password) {
    const result = await readyClient().auth.signInWithPassword({email, password});
    if (result.error) throw result.error;
    return result.data;
  }
  async function signUp(email, password) {
    const result = await readyClient().auth.signUp({email, password, options: {emailRedirectTo: origin + '/'}});
    if (result.error) throw result.error;
    return result.data;
  }
  async function signOut() {
    if (!client) return;
    signingOut = true;
    acceptSession(null, 'SIGNED_OUT');
    // Clear the UI immediately, including requests that were already in flight.
    try {
      const result = await client.auth.signOut({scope: 'local'});
      if (result.error) throw result.error;
      signingOut = false;
      acceptSession(null, 'SIGNED_OUT');
    } catch (cause) {
      status = 'signout_error'; error = 'Sign-out could not finish. Retry signing out before closing this browser.';
      emit('SIGNOUT_ERROR');
      throw new Error(error);
    }
  }
  async function resetPassword(email) {
    const result = await readyClient().auth.resetPasswordForEmail(email, {redirectTo: origin + '/'});
    if (result.error) throw result.error;
  }
  async function updatePassword(password) {
    const version = epoch;
    if (!session) throw new Error('Open a fresh password-reset link to continue.');
    const result = await readyClient().auth.updateUser({password});
    current(version);
    if (result.error) throw result.error;
  }
  return {
    initialize, snapshot, request, signIn, signUp, signOut, resetPassword, updatePassword,
    isCurrent: version => version === epoch,
    dispose() { subscription?.unsubscribe(); if (expiryTimer !== null) cancel(expiryTimer); invalidate(); },
  };
}
