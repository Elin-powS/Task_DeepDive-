/**
 * vite-dev-api-plugin.js
 * -----------------------------------------------------------------
 * Local-dev-only. Makes `npm run dev` (plain Vite) understand
 * POST /api/generate-insights, the same route Vercel serves in
 * production via the /api folder. Without this, that endpoint 404s
 * under plain Vite — this plugin fixes that by handling the request
 * directly inside Vite's own dev server using Node middleware.
 *
 * Uses the exact same logic as api/generate-insights.js (imported
 * from api/_lib/groqInsights.js), so local and production behave
 * identically — the only difference is where the request is caught.
 *
 * Usage in vite.config.js:
 *
 *   import { defineConfig, loadEnv } from 'vite'
 *   import react from '@vitejs/plugin-react'
 *   import devApiPlugin from './vite-dev-api-plugin'
 *
 *   export default defineConfig(({ mode }) => {
 *     const env = loadEnv(mode, process.cwd(), '')
 *     process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || env.GROQ_API_KEY
 *     return {
 *       plugins: [react(), devApiPlugin()],
 *     }
 *   })
 * -----------------------------------------------------------------
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

// Vite bundles vite.config.js (and files it statically imports, like this
// plugin) into node_modules/.vite-temp/ before running it. A bare relative
// dynamic import() below would then resolve against THAT temp location, not
// the real project folder — causing ERR_MODULE_NOT_FOUND. Resolving against
// this file's own import.meta.url sidesteps that.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const groqInsightsPath = path.join(__dirname, "api", "lib", "groqInsights.js");
const groqInsightsUrl = new URL(`file://${groqInsightsPath.replace(/\\/g, "/")}`).href;

export default function devApiPlugin() {
  return {
    name: "dev-api-generate-insights",
    configureServer(server) {
      server.middlewares.use("/api/generate-insights", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }
        try {
          // Vite's Node middleware doesn't auto-parse the body — read it manually.
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
          const { PROCESSED } = body;

          if (!PROCESSED) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Missing PROCESSED in request body" }));
            return;
          }

          const { generateInsights } = await import(/* @vite-ignore */ groqInsightsUrl);
          const out = await generateInsights(PROCESSED);

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(out));
        } catch (e) {
          console.error("[dev-api] generate-insights failed:", e);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message || "Internal error" }));
        }
      });
    },
  };
}