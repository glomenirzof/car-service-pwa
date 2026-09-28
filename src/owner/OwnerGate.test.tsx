import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Route, Routes} from 'react-router';
import {renderApp, testBoot} from '@/test/render';
import {safeStorage} from '@/shared/storage';
import {AuthProvider, useAuth} from './auth';
import {OwnerGate} from './OwnerGate';

// Fake Supabase Auth client: the real one would talk to GoTrue.
type Listener = (event: string, session: unknown) => void;
const auth = vi.hoisted(() => ({
  session: null as null | {access_token: string; user: {id: string; email: string}},
  listeners: [] as Listener[],
  signOutCalls: 0,
}));

vi.mock('./supabase', () => ({
  authStorageKey: (slug: string) => `sb-owner-${slug}`,
  supabase: () => ({
    auth: {
      getSession: async () => ({data: {session: auth.session}}),
      onAuthStateChange: (fn: Listener) => {
        auth.listeners.push(fn);
        return {data: {subscription: {unsubscribe: () => undefined}}};
      },
      signOut: async () => {
        auth.signOutCalls++;
        auth.session = null;
        return {error: null};
      },
      signInWithPassword: async () => ({error: new Error('Invalid login credentials')}),
      signInWithOtp: async () => ({error: null}),
    },
  }),
}));

const ownerBoot = {...testBoot, app: 'owner' as const, basePath: '/s/alpha/owner'};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function LogoutProbe() {
  const {signOut} = useAuth();
  return <button onClick={() => void signOut()}>probe-logout</button>;
}

function renderOwner() {
  return renderApp(
    <AuthProvider>
      <Routes>
        <Route element={<OwnerGate />}>
          <Route
            index
            element={
              <div>
                <p>schedule-screen</p>
                <LogoutProbe />
              </div>
            }
          />
        </Route>
      </Routes>
    </AuthProvider>,
    {boot: ownerBoot},
  );
}

describe('owner cabinet gate', () => {
  beforeEach(() => {
    auth.session = null;
    auth.listeners = [];
    auth.signOutCalls = 0;
    vi.restoreAllMocks();
  });

  it('shows login without any sign-up path when there is no session', async () => {
    renderOwner();
    expect(await screen.findByRole('heading', {name: 'Кабинет'})).toBeInTheDocument();
    expect(screen.getByLabelText(/Почта/)).toBeInTheDocument();
    for (const role of ['button', 'link'] as const) {
      expect(screen.queryAllByRole(role).filter((el) => /регистр|создать аккаунт|sign ?up/i.test(el.textContent ?? ''))).toHaveLength(0);
    }
    expect(screen.getByText(/Регистрации нет/)).toBeInTheDocument();
  });

  it('reports a wrong password without revealing details', async () => {
    renderOwner();
    await userEvent.type(await screen.findByLabelText(/Почта/), 'x@example.com');
    await userEvent.type(screen.getByLabelText(/Пароль/), 'nope');
    await userEvent.click(screen.getByRole('button', {name: 'Войти'}));
    expect(await screen.findByText('Неверная почта или пароль.')).toBeInTheDocument();
  });

  it('refuses a signed-in user who is not a member of this studio', async () => {
    auth.session = {access_token: 'tok', user: {id: 'u1', email: 'other@example.com'}};
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({user: {id: 'u1', email: 'other@example.com'}, tenants: [{tenantId: 't-beta', slug: 'beta', name: 'Beta', role: 'owner', status: 'live'}]}),
    );
    renderOwner();
    expect(await screen.findByText('Нет доступа к этой студии')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/owner-api/context');
    expect(new Headers((init as RequestInit).headers).get('Authorization')).toBe('Bearer tok');
    expect(screen.queryByText('schedule-screen')).not.toBeInTheDocument();
  });

  it('logout drops cached private data, chat history and the stored session', async () => {
    auth.session = {access_token: 'tok', user: {id: 'u1', email: 'me@example.com'}};
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/context')) return json({user: {id: 'u1', email: 'me@example.com'}, tenants: [{tenantId: 't-alpha', slug: 'alpha', name: 'Alpha', role: 'owner', status: 'live'}]});
      if (url.endsWith('/t/t-alpha/tenant')) return json({tenant: {id: 't-alpha', slug: 'alpha', name: 'Alpha', timezone: 'Europe/Moscow', status: 'live', services: [], resources: []}});
      return json({error: 'not_found'}, 404);
    });
    safeStorage.set('owner-chat:alpha', [{role: 'user', content: 'выручка'}], 'session');
    safeStorage.set('sb-owner-alpha', {access_token: 'tok'});

    const {queryClient} = renderOwner();
    expect(await screen.findByText('schedule-screen')).toBeInTheDocument();
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', {name: 'probe-logout'}));

    await waitFor(() => expect(screen.getByRole('heading', {name: 'Кабинет'})).toBeInTheDocument());
    expect(auth.signOutCalls).toBe(1);
    // Only the (disabled, empty) context query of the login screen may exist.
    expect(queryClient.getQueryCache().getAll().filter((q) => q.state.data !== undefined)).toHaveLength(0);
    expect(safeStorage.get('owner-chat:alpha', null, 'session')).toBeNull();
    expect(safeStorage.get('sb-owner-alpha', null)).toBeNull();
  });

  it('signs out when the server rejects the token', async () => {
    auth.session = {access_token: 'expired', user: {id: 'u1', email: 'me@example.com'}};
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({error: 'unauthenticated', message: 'jwt expired'}, 401));
    renderOwner();
    await waitFor(() => expect(auth.signOutCalls).toBe(1));
    expect(await screen.findByRole('heading', {name: 'Кабинет'})).toBeInTheDocument();
  });
});
