import {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';
import type {Session} from '@supabase/supabase-js';
import {useQueryClient} from '@tanstack/react-query';
import {safeStorage} from '@/shared/storage';
import {apiRequest} from '@/shared/api';
import {currentPushEndpoint} from '@/shared/pwa';
import {useBoot} from '@/app/boot-context';
import {authStorageKey, supabase} from './supabase';

type AuthState = {
  session: Session | null;
  ready: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  accessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthState | null>(null);

export const OWNER_CONTEXT_KEY = ['owner', 'context'] as const;
export const ownerPushKey = (slug: string) => `owner-push:${slug}`;
type ContextData = {tenants: {tenantId: string; slug: string}[]};

export function AuthProvider({children}: {children: ReactNode}) {
  const {slug, basePath} = useBoot();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const sb = supabase(slug);

  useEffect(() => {
    let alive = true;
    void sb.auth.getSession().then(({data}) => {
      if (!alive) return;
      setSession(data.session);
      setReady(true);
    });
    const {data: sub} = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [sb]);

  const signOut = useCallback(async () => {
    // Owner notifications carry customer names: this device stops receiving
    // them. Done while the token is still valid; the browser subscription
    // itself stays, it may also serve this device's client reminders.
    await forgetOwnerPush(slug, queryClient.getQueryData<ContextData>(OWNER_CONTEXT_KEY), (await sb.auth.getSession()).data.session?.access_token).catch(() => undefined);
    // Private data must not outlive the session: drop every cached query,
    // the owner assistant history and the Supabase session itself.
    await sb.auth.signOut({scope: 'local'}).catch(() => undefined);
    queryClient.cancelQueries();
    queryClient.clear();
    safeStorage.remove(`owner-chat:${slug}`, 'session');
    safeStorage.remove(authStorageKey(slug));
    safeStorage.remove(ownerPushKey(slug));
    setSession(null);
  }, [sb, queryClient, slug]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      ready,
      signInWithPassword: async (email, password) => {
        const {error} = await sb.auth.signInWithPassword({email, password});
        if (error) throw error;
      },
      sendMagicLink: async (email) => {
        // shouldCreateUser: false — a magic link can never create an account.
        const {error} = await sb.auth.signInWithOtp({email, options: {shouldCreateUser: false, emailRedirectTo: `${window.location.origin}${basePath}/`}});
        if (error) throw error;
      },
      signOut,
      accessToken: async () => (await sb.auth.getSession()).data.session?.access_token ?? null,
    }),
    [session, ready, sb, signOut, basePath],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function forgetOwnerPush(slug: string, context: ContextData | undefined, accessToken: string | undefined) {
  const tenantId = context?.tenants.find((t) => t.slug === slug)?.tenantId;
  if (!tenantId || !accessToken) return;
  const endpoint = await currentPushEndpoint(slug);
  if (!endpoint) return;
  await apiRequest('owner-api', `/t/${tenantId}/push/delete`, {method: 'POST', body: {endpoint}, accessToken, signal: AbortSignal.timeout(4000)});
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
