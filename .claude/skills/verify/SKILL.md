---
name: verify
description: Build, launch, and drive the Vito web app to verify changes at the browser surface.
---

# Verifying Vito (web)

## Launch

```bash
printf 'OPENAI_API_KEY=sk-fake\n' > .env   # any value; only needed at record time
npm run dev &                              # http://localhost:3000, ready in ~5-10s
```

Drive with Playwright against the pre-installed Chromium
(`executablePath: '/opt/pw-browsers/chromium'`). No mic in headless — the
record flow can't be exercised end-to-end; everything else can.

## Auth (Neon Auth, optional)

Auth is enabled by setting `VITE_NEON_AUTH_URL` in `.env` **before** starting
the dev server (Vite bakes env at startup — restart to toggle). Without it the
app skips the login gate entirely.

To test the login flow without a real Neon project, run a fake Better Auth
endpoint and point `VITE_NEON_AUTH_URL=http://localhost:8787` at it. Gotchas
learned the hard way:

- The `@neondatabase/auth` client appends `/api/auth` to the base URL
  (requests hit `/api/auth/sign-in/email`, `/api/auth/get-session`, …).
- CORS preflight must allow the `x-neon-client-info` request header —
  reflect `access-control-request-headers` and set
  `access-control-allow-credentials: true`.
- Wire format is Better Auth: sign-in/up return `{ token, user }` (401/422 +
  `{ message }` on error); `get-session` returns `{ session, user }` or `null`.
  The SDK caches the bearer token itself, so session restore across reloads
  works even against a cookie-less fake.

## Flows worth driving

- Login screen: bad password → inline error; sign-up ↔ sign-in toggle;
  successful sign-in → workspace with user + Sign out in the sidebar footer.
- No `VITE_NEON_AUTH_URL` → workspace renders directly, no account footer.
- Space in a form field must type a space, not toggle recording
  (`src/routes/index.tsx` guards INPUT/TEXTAREA targets).
