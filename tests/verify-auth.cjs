const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const calls = {};
let currentSession = null;
const auth = {
  onAuthStateChange(callback) {
    calls.callback = callback;
    return { data: { subscription: { unsubscribe() { calls.unsubscribed = true; } } } };
  },
  async getSession() { return { data: { session: currentSession }, error: null }; },
  async signUp(input) { calls.signUp = input; return { data: { session: null }, error: null }; },
  async signInWithPassword(input) { calls.signIn = input; return { data: { session: { user: { id: 'user-1' } } }, error: null }; },
  async resetPasswordForEmail(email, options) { calls.reset = { email, options }; return { data: {}, error: null }; },
  async updateUser(input) { calls.update = input; return { data: {}, error: null }; },
  async signOut(input) { calls.signOut = input; return { error: null }; }
};
const window = {
  location: { origin: 'https://visionguide.example' },
  setTimeout(callback) { callback(); },
  fetch: async () => ({ ok: true, json: async () => ({ supabase: {
    url: 'https://project.supabase.co', publishableKey: 'sb_publishable_test', configured: true
  } }) }),
  supabase: { createClient(url, key, options) { calls.create = { url, key, options }; return { auth }; } }
};
const context = { window, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync('dist/authService.js', 'utf8'), context);

(async () => {
  const events = [];
  assert.equal(await window.supabaseAuth.initialize((event, session) => events.push({ event, session })), null);
  assert.equal(calls.create.url, 'https://project.supabase.co');
  assert.equal(calls.create.key, 'sb_publishable_test');
  assert.equal(calls.create.options.auth.persistSession, true);
  assert.equal(calls.create.options.auth.autoRefreshToken, true);
  assert.equal(calls.create.options.auth.detectSessionInUrl, true);

  await window.supabaseAuth.signUp({ name: 'Test User', email: 'test@example.com', password: 'password-123' });
  assert.equal(calls.signUp.options.data.display_name, 'Test User');
  assert.equal(calls.signUp.options.emailRedirectTo, 'https://visionguide.example/');
  await window.supabaseAuth.signIn({ email: 'test@example.com', password: 'password-123' });
  assert.equal(calls.signIn.email, 'test@example.com');
  currentSession = { access_token: 'test-access-token', user: { id: 'user-1' } };
  assert.equal(await window.supabaseAuth.getAccessToken(), 'test-access-token');
  await window.supabaseAuth.requestPasswordReset('test@example.com');
  assert.equal(calls.reset.options.redirectTo, 'https://visionguide.example/');
  await window.supabaseAuth.updatePassword('new-password-123');
  assert.equal(calls.update.password, 'new-password-123');
  await window.supabaseAuth.signOut();
  assert.equal(calls.signOut.scope, 'local');
  calls.callback('SIGNED_IN', { user: { id: 'user-1' } });
  assert.equal(events[0].event, 'SIGNED_IN');
  window.supabaseAuth.destroy();
  assert.equal(calls.unsubscribed, true);
  console.log('PASS: Supabase configuration, persistent session, sign-up, sign-in, recovery, password update, and sign-out contract.');
})().catch(error => { console.error(error); process.exitCode = 1; });
