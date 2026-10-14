import { existsSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// Push notifications need a Firebase project, which an Android build only
// has if android/app/google-services.json is there. Without it, asking the
// push plugin to register crashes the app, so the app only tries when the
// build was made with one (read in src/lib/push.js).
if (process.env.KTL_PUBLIC_BUILD === '1') {
  // The public APK isn't tied to anyone's Firebase project: no push.
  process.env.VITE_KTL_PUSH = 'false'
} else if (process.env.VITE_KTL_PUSH === undefined) {
  process.env.VITE_KTL_PUSH = existsSync('android/app/google-services.json') ? 'true' : 'false'
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    // The server's gateway has its own node:test suite (cd selfhost/gateway && npm test).
    exclude: [...configDefaults.exclude, 'selfhost/**', 'e2e/**'],
  },
})
