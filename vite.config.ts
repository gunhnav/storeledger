import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Mã phiên bản mỗi lần build: app so với /version.json để biết đã có bản mới (xem src/components/UpdateWatcher.tsx)
const BUILD_ID = String(Date.now())

// https://vite.dev/config/
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) })
      },
    },
  ],
  build: {
    rolldownOptions: {
      output: {
        // Tách thư viện ra chunk riêng: trình duyệt cache được lâu, code app đổi không làm tải lại thư viện
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 2 },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
