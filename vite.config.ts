import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  if (command === "serve") {
    const env = loadEnv(mode, process.cwd(), ["GEMINI_API_KEY", "VITO_"]);
    for (const [key, value] of Object.entries(env)) {
      process.env[key] ??= value;
    }
  }

  return {
    plugins: [
      solid({
        ssr: true,
        start: { nodeServer: true },
        serverFunctions: true,
      }),
    ],
    resolve: {
      alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: { port: 3000 },
  };
});
