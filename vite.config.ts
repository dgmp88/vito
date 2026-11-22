import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  if (command === "serve") {
    // Server-side env for server functions in dev (`npm start` reads .env itself).
    const env = loadEnv(mode, process.cwd(), ["GEMINI_API_KEY", "DATABASE_URL", "NEON_AUTH_URL", "VITE_NEON_AUTH_URL"]);
    for (const [key, value] of Object.entries(env)) {
      process.env[key] ??= value;
    }
  }

  return {
    plugins: [
      solid({
        ssr: true,
        start: true,
        serverFunctions: { serverSetup: "./src/serverErrors.ts" },
      }),
      // Deploy adapter. Picks the preset from the build environment: on Vercel
      // it writes .vercel/output (Build Output API).
      nitro(),
    ],
    resolve: {
      alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: { port: 3000 },
  };
});
