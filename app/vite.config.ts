import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const DATA_DIR = fileURLToPath(new URL('../data', import.meta.url))
// What the app may read from data/. raw/ (downloads) is never served or shipped.
const PUBLIC_DATA = ['config.json', 'SOURCES.md', 'consignes.json', 'site', 'weather', 'nist']
const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.bin': 'application/octet-stream',
}

/** Serves ../data at /data in dev and copies it into dist/data on build. */
function dataDir(): Plugin {
  let outDir = 'dist'
  return {
    name: 'pnr-data',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^[\\/]+/, '')
        const top = path.split(sep)[0]
        const file = join(DATA_DIR, path)
        if (!PUBLIC_DATA.includes(top) || !file.startsWith(DATA_DIR) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      if (!existsSync(join(DATA_DIR, 'config.json'))) {
        console.warn('[pnr-data] data/config.json not found: build has no data.')
        return
      }
      for (const entry of PUBLIC_DATA) {
        const from = join(DATA_DIR, entry)
        if (existsSync(from)) cpSync(from, join(outDir, 'data', entry), { recursive: true })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dataDir()],
  // The model files and the contract live in ../ml/model (shared with the Python side).
  server: { fs: { allow: ['..'] } },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/legacy/**', 'node_modules/**'],
  },
})
