import { createInternalNeonAuth } from "@neondatabase/auth";
import { createSignal } from "solid-js";

// Neon Auth (https://neon.com/docs/auth/overview), email + password.
//
// The client talks directly to the Neon Auth endpoint (VITE_NEON_AUTH_URL,
// from Neon Console → your project → Auth). Sessions are managed by the SDK.
// When the URL isn't configured, auth is disabled and the app works without
// signing in — conversations are local to the browser either way.

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

const authUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;

export const authEnabled = Boolean(authUrl);

interface AuthResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

interface RawUser {
  id: string;
  email: string;
  name?: string | null;
}

// The slice of the Better Auth vanilla client (the SDK's default adapter) that
// we use. In 0.4.2-beta the SDK's exported `VanillaBetterAuthClient` type
// doesn't structurally match createAuthClient's return type (duplicated
// bundled declarations), so we describe the surface we need and cast once.
interface NeonAuthClient {
  signIn: {
    email(input: { email: string; password: string }): Promise<AuthResult<{ user: RawUser }>>;
  };
  signUp: {
    email(input: {
      name: string;
      email: string;
      password: string;
    }): Promise<AuthResult<{ user: RawUser }>>;
  };
  getSession(): Promise<AuthResult<{ user: RawUser }>>;
  signOut(): Promise<unknown>;
}

// createInternalNeonAuth returns both the Better Auth client (`.adapter`, used
// for sign in/up/session/out) and `getJWTToken()`, the source of the session JWT
// we send to the persistence server functions. `createAuthClient` exposes only
// the adapter, so we go one level up.
interface NeonAuth {
  adapter: NeonAuthClient;
  getJWTToken(): Promise<string | null>;
}

let instance: NeonAuth | undefined;

function neon(): NeonAuth {
  if (!instance) instance = createInternalNeonAuth(authUrl!) as unknown as NeonAuth;
  return instance;
}

function auth(): NeonAuthClient {
  return neon().adapter;
}

/**
 * The current session's JWT, or null when auth is disabled or nobody is signed
 * in. The persistence layer passes this to the server, which verifies it and
 * scopes every query to the user.
 */
export async function authToken(): Promise<string | null> {
  if (!authEnabled) return null;
  try {
    return await neon().getJWTToken();
  } catch {
    return null;
  }
}

const [user, setUser] = createSignal<AuthUser | null>(null);
// Start true so the app doesn't flash the login form while restoring a session.
const [sessionLoading, setSessionLoading] = createSignal(authEnabled);

export { user as authUser, sessionLoading };

function toAuthUser(u: RawUser): AuthUser {
  return { id: u.id, email: u.email, name: u.name ?? null };
}

/** Restore an existing session on app load. */
export async function loadSession(): Promise<void> {
  if (!authEnabled) return;
  try {
    const { data } = await auth().getSession();
    setUser(data?.user ? toAuthUser(data.user) : null);
  } catch {
    setUser(null);
  } finally {
    setSessionLoading(false);
  }
}

/** Returns an error message, or null on success. */
export async function signIn(email: string, password: string): Promise<string | null> {
  try {
    const { data, error } = await auth().signIn.email({ email, password });
    if (error || !data?.user) return error?.message || "Sign in failed.";
    setUser(toAuthUser(data.user));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Sign in failed.";
  }
}

/** Returns an error message, or null on success. */
export async function signUp(name: string, email: string, password: string): Promise<string | null> {
  try {
    const { data, error } = await auth().signUp.email({
      // Neon Auth (Better Auth) requires a display name on sign-up.
      name: name.trim() || email.split("@")[0],
      email,
      password,
    });
    if (error || !data?.user) return error?.message || "Sign up failed.";
    setUser(toAuthUser(data.user));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Sign up failed.";
  }
}

export async function signOut(): Promise<void> {
  try {
    await auth().signOut();
  } finally {
    setUser(null);
  }
}
