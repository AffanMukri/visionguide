(function () {
  'use strict';

  let client = null;
  let subscription = null;
  let initialized = false;

  function requireClient() {
    if (!client) throw new Error('Authentication is not configured.');
    return client;
  }

  function redirectUrl() {
    return `${window.location.origin}/`;
  }

  async function initialize(onAuthChange) {
    if (initialized) {
      const { data } = await requireClient().auth.getSession();
      return data.session;
    }
    if (!window.supabase?.createClient) throw new Error('The authentication client could not load.');

    const response = await window.fetch('/api/public-config', { headers: { Accept: 'application/json' } });
    const config = await response.json().catch(() => ({}));
    if (!response.ok || !config.supabase?.configured)
      throw new Error('Supabase authentication is not configured on the server.');

    client = window.supabase.createClient(config.supabase.url, config.supabase.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'visionguide-auth-session'
      }
    });
    initialized = true;
    const result = client.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => onAuthChange?.(event, session), 0);
    });
    subscription = result.data.subscription;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function signUp({ name, email, password }) {
    return requireClient().auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl(),
        data: { display_name: name }
      }
    });
  }

  async function signIn({ email, password }) {
    return requireClient().auth.signInWithPassword({ email, password });
  }

  async function requestPasswordReset(email) {
    return requireClient().auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
  }

  async function updatePassword(password) {
    return requireClient().auth.updateUser({ password });
  }

  async function signOut() {
    return requireClient().auth.signOut({ scope: 'local' });
  }

  function destroy() {
    subscription?.unsubscribe?.();
    subscription = null;
  }

  window.supabaseAuth = { initialize, signUp, signIn, requestPasswordReset, updatePassword, signOut, destroy };
})();
