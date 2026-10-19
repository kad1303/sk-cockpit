'use strict';

/* ============================================================
   Anmeldung und Datenzugriff (Supabase).
   Es gibt keine Selbst-Registrierung: Zugänge legt supabase/deploy.rb an.
   ============================================================ */

const CFG = window.SK_CONFIG || { url: '', key: '' };
const AUTH_KEY = 'skcockpit:auth';

class AuthError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

const Auth = {
  session: null,
  onExpired: null,

  configured() { return !!(CFG.url && CFG.key); },

  load() {
    try { this.session = JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { this.session = null; }
    return this.session;
  },

  save(s) {
    this.session = s;
    try {
      if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s));
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) {
      console.warn('Sitzung nicht gespeichert', e);
    }
  },

  from(data) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: { id: data.user.id, email: data.user.email },
    };
  },

  async request(path, body, method = 'POST', token) {
    const res = await fetch(`${CFG.url}/auth/v1/${path}`, {
      method,
      headers: {
        apikey: CFG.key,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AuthError(data.msg || data.error_description || data.message || `Fehler ${res.status}`, res.status, data.error_code || data.code);
    return data;
  },

  async signIn(email, password) {
    this.save(this.from(await this.request('token?grant_type=password', { email: email.trim(), password })));
  },

  async signOut() {
    const token = this.session && this.session.access_token;
    this.save(null);
    if (token) fetch(`${CFG.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: CFG.key, Authorization: `Bearer ${token}` } }).catch(() => {});
  },

  async setPassword(password) {
    await this.request('user', { password }, 'PUT', await this.token());
  },

  async token() {
    const s = this.session;
    if (!s) throw new AuthError('Nicht angemeldet', 401);
    if (Date.now() < s.expires_at - 60000) return s.access_token;
    try {
      this.save(this.from(await this.request('token?grant_type=refresh_token', { refresh_token: s.refresh_token })));
      return this.session.access_token;
    } catch (e) {
      if (e instanceof AuthError && e.status >= 400 && e.status < 500) {
        this.save(null);
        if (this.onExpired) this.onExpired();
      }
      throw e;
    }
  },

  // Anfrage an Datenbank oder Ablage, mit einem Wiederholungsversuch nach Token-Erneuerung
  async fetch(path, opts = {}) {
    const go = async () => fetch(`${CFG.url}${path}`, {
      ...opts,
      headers: { apikey: CFG.key, Authorization: `Bearer ${await this.token()}`, ...(opts.headers || {}) },
    });
    let res = await go();
    if (res.status === 401 && this.session) {
      this.session.expires_at = 0;
      res = await go();
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new AuthError(d.message || d.msg || d.error || `Fehler ${res.status}`, res.status, d.code);
    }
    return res;
  },

  async select(table, query) {
    return (await this.fetch(`/rest/v1/${table}?${query}`)).json();
  },

  async insert(table, row) {
    const res = await this.fetch(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    return (await res.json())[0];
  },

  async update(table, query, patch) {
    const res = await this.fetch(`/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    return res.json();
  },

  async rpc(fn, args) {
    const res = await this.fetch(`/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    });
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  },

  async upload(bucket, path, file) {
    await this.fetch(`/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' },
      body: file,
    });
  },

  async signedUrl(bucket, path) {
    const res = await this.fetch(`/storage/v1/object/sign/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 300 }),
    });
    const d = await res.json();
    return CFG.url + '/storage/v1' + d.signedURL;
  },
};

function friendlyAuthError(e) {
  const msg = String(e.message || '').toLowerCase();
  if (e.code === 'invalid_credentials' || msg.includes('invalid login')) return 'E-Mail oder Passwort stimmt nicht.';
  if (e.code === 'weak_password' || msg.includes('password should')) return 'Das Passwort ist zu kurz (mindestens 8 Zeichen).';
  if (e.code === 'same_password') return 'Das ist schon dein aktuelles Passwort.';
  if (e.code === 'over_request_rate_limit' || msg.includes('rate limit')) return 'Zu viele Versuche. Bitte in ein paar Minuten erneut probieren.';
  if (e instanceof TypeError) return 'Keine Verbindung. Bist du online?';
  return e.message || 'Unbekannter Fehler';
}
