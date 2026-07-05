import { createSignal, JSX, Match, Show, Switch } from "solid-js";
import { authUser, sessionLoading, signIn, signUp } from "~/lib/auth";

/**
 * Renders children only once signed in. Otherwise shows the email/password
 * login screen.
 */
export default function AuthGate(props: { children: JSX.Element }) {
  return (
    <Switch fallback={<LoginScreen />}>
      <Match when={authUser()}>{props.children}</Match>
      <Match when={sessionLoading()}>
        <div class="auth">
          <p class="auth__loading">Loading…</p>
        </div>
      </Match>
    </Switch>
  );
}

function LoginScreen() {
  const [mode, setMode] = createSignal<"signin" | "signup">("signin");
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const switchMode = (next: "signin" | "signup") => {
    setMode(next);
    setError(null);
  };

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    setError(null);
    const err =
      mode() === "signin"
        ? await signIn(email(), password())
        : await signUp(name(), email(), password());
    setBusy(false);
    setError(err);
  };

  return (
    <div class="auth">
      <form class="auth__card" onSubmit={handleSubmit}>
        <div class="auth__brand">
          <img src="/logo.svg" class="auth__logo" alt="" />
          <span class="auth__title">Vito</span>
        </div>
        <p class="auth__subtitle">
          {mode() === "signin" ? "Sign in to continue" : "Create an account"}
        </p>

        <Show when={mode() === "signup"}>
          <label class="auth__field">
            <span>Name</span>
            <input
              type="text"
              autocomplete="name"
              placeholder="Your name"
              value={name()}
              onInput={e => setName(e.currentTarget.value)}
            />
          </label>
        </Show>

        <label class="auth__field">
          <span>Email</span>
          <input
            type="email"
            required
            autocomplete="email"
            placeholder="you@example.com"
            value={email()}
            onInput={e => setEmail(e.currentTarget.value)}
          />
        </label>

        <label class="auth__field">
          <span>Password</span>
          <input
            type="password"
            required
            minlength={8}
            autocomplete={mode() === "signin" ? "current-password" : "new-password"}
            placeholder="••••••••"
            value={password()}
            onInput={e => setPassword(e.currentTarget.value)}
          />
        </label>

        <Show when={error()}>
          <p class="auth__error">{error()}</p>
        </Show>

        <button class="auth__submit" type="submit" disabled={busy()}>
          {busy() ? "…" : mode() === "signin" ? "Sign in" : "Sign up"}
        </button>

        <p class="auth__switch">
          <Show
            when={mode() === "signin"}
            fallback={
              <>
                Already have an account?{" "}
                <button type="button" onClick={() => switchMode("signin")}>
                  Sign in
                </button>
              </>
            }
          >
            No account?{" "}
            <button type="button" onClick={() => switchMode("signup")}>
              Sign up
            </button>
          </Show>
        </p>
      </form>
    </div>
  );
}
