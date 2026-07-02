import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Dev server: roda em 6002 e proxeia /api para o greenn-back local (porta 81 no host).
// Em produção (Docker) quem faz esse proxy é o server.js (Express), usando o hostname do container.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 6002,
    proxy: {
      '/api': {
        target: process.env.GREENN_BACK_URL || 'http://localhost:81',
        changeOrigin: true,
      },
    },
  },
});
