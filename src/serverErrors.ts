// Server-only. In production Solid replaces unexpected server errors with a
// generic message and doesn't log them, so a failing server function shows up
// in the host's logs as a bare 500. Log every one with its stack. Returning
// nothing keeps the default policy for what the client sees.

import { configureServerErrors } from "@solidjs/web";

configureServerErrors({
  onError(error, { kind, handling, functionId }) {
    console.error(`[server error] ${kind}/${handling}${functionId ? ` in ${functionId}` : ""}:`, error);
  },
});
