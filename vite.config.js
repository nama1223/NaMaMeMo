import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const BASE = '/NaMaMeMo/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',

      manifest: {
        name: 'NaMaMeMo',
        short_name: 'NaMaMeMo',
        description: 'アウトラインプロセッサ型メモアプリ.', // ★実はここを変えるとキャッシュ対策になります
        theme_color: '#1c1c1e',
        background_color: '#FDF8E5',
        display: 'standalone',
        start_url: BASE,
        scope: BASE,
        lang: 'ja',
        icons: [
          // ★ 修正：purpose を 'any maskable' と一つにまとめます！
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
        share_target: {
          action: BASE + 'share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              { name: 'images', accept: ['image/*'] },
              { name: 'audio',  accept: ['audio/*'] },
              { name: 'video',  accept: ['video/*'] },
              { name: 'files',  accept: [
                'text/*',
                'application/pdf',
                'application/json',
                'application/zip',
                'application/octet-stream',
              ]},
            ],
          },
        },
      },

      registerType: 'prompt',
      injectRegister: null, 
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})