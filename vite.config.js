import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // relative paths so the build works under https://<user>.github.io/<repo>/
  base: './',
  plugins: [svelte()],
})
