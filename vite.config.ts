import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  // 原生产物目录不参与监听/打包：build 与 build-validation 里正在被编译器写着的
  // .obj 会让文件监视器报 EBUSY 直接崩掉 dev server。
  server: { strictPort: true, port: 5173, watch: { ignored: ['**/build/**', '**/build-validation/**', '**/dist/**', '**/.tools/**'] } },
})
