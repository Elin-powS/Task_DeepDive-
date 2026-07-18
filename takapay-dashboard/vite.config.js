import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import devApiPlugin from './vite-dev-api-plugin'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv reads .env, but Vite only exposes VITE_-prefixed keys via
  // import.meta.env — it does NOT put arbitrary keys onto process.env.
  // groqInsights.js reads process.env.GROQ_API_KEY, so we set it here.
  const env = loadEnv(mode, process.cwd(), '')
  process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || env.GROQ_API_KEY

  return {
    plugins: [react(), devApiPlugin()],
  }
})