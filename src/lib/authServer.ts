// Server-only. Verifies a Neon Auth session JWT and returns the user id.
//
// The browser gets its JWT from the Neon Auth SDK (auth.ts `authToken()`) and
// passes it to every persistence server function. Here we verify that token's
// signature against Neon Auth's JWKS (Better Auth's jwt plugin) and read the
// `sub` claim — the id in `neon_auth.user`. Verifying (not just decoding) is what
// lets us trust the user id we scope every query by.
//
// Reached only from inside `"use server"` functions (imported dynamically), so
// jose never lands in the client bundle.

import { createRemoteJWKSet, jwtVerify } from "jose";

type Jwks = ReturnType<typeof createRemoteJWKSet>;

let jwks: Jwks | undefined;

function jwksUrl(): URL {
  // Explicit override wins (e.g. if your deployment serves JWKS elsewhere).
  const explicit = process.env.NEON_JWKS_URL;
  if (explicit) return new URL(explicit);

  // Otherwise derive it from the Neon Auth base URL: Better Auth serves the key
  // set at `<base>/jwks`. VITE_-prefixed vars are loaded into process.env on the
  // server too; NEON_AUTH_URL is accepted as a non-public alias.
  const base = process.env.NEON_AUTH_URL || process.env.VITE_NEON_AUTH_URL;
  if (!base) {
    throw new Error(
      "Neon Auth is not configured on the server. Set VITE_NEON_AUTH_URL (or NEON_JWKS_URL)."
    );
  }
  return new URL(`${base.replace(/\/+$/, "")}/jwks`);
}

/** Verify the session JWT and return the user id (`sub`). Throws if invalid. */
export async function verifyUser(token: string | null | undefined): Promise<string> {
  if (!token) throw new Error("Not authenticated: no session token.");
  if (!jwks) jwks = createRemoteJWKSet(jwksUrl());
  const { payload } = await jwtVerify(token, jwks);
  if (!payload.sub) throw new Error("Session token has no subject (user id).");
  return payload.sub;
}
