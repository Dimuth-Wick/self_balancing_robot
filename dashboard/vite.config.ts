/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Component tests load the icon set, which takes a few seconds the first time.
  test: { testTimeout: 20000 },
})
