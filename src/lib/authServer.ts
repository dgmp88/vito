// Server-only. Verifies a Neon Auth session JWT and returns the user id.
//
// The browser gets its JWT from the Neon Auth SDK (auth.ts `authToken()`) and
// passes it to every server function. We verify the signature against Neon
// Auth's JWKS and check the issuer (https://neon.com/docs/auth/guides/plugins/jwt),
// then read `sub`, the id in neon_auth.user.

import { markSafeError } from "@solidjs/web";
import { createRemoteJWKSet, jwtVerify } from "jose";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function authBaseUrl(): string {
  const base = process.env.VITE_NEON_AUTH_URL;
  if (!base) throw new Error("Neon Auth is not configured on the server. Set VITE_NEON_AUTH_URL.");
  return base.replace(/\/+$/, "");
}

/** Verify the session JWT and return the user id (`sub`). Throws if invalid. */
export async function verifyUser(token: string): Promise<string> {
  if (!token) throw markSafeError(new Error("Not signed in."));
  const base = authBaseUrl();
  jwks ??= createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: new URL(base).origin });
    if (!payload.sub) throw new Error("Session token has no subject.");
    return payload.sub;
  } catch (error) {
    throw markSafeError(new Error(`Not signed in: ${(error as Error).message}`));
  }
}
