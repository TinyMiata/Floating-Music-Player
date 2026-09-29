import { resolve } from 'path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('src/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve('src/preload/index.ts') } } },
  renderer: {
    root: 'src/renderer',
    plugins: [
      {
        // Electron only needs woff2; drop the legacy remixicon font formats from the bundle
        name: 'remixicon-woff2-only',
        enforce: 'pre',
        transform(code, id) {
          if (!id.endsWith('remixicon.css')) return null
          return code.replace(/src: url\('remixicon\.eot[\s\S]*?font-display/, 'src: url("remixicon.woff2") format("woff2");\n  font-display')
        }
      }
    ],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
