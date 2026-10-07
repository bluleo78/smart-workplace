import { defineConfig } from 'vitest/config'

// 스키마 패키지 테스트 — tiptap 헤드리스 Editor 가 DOM 전역을 요구하므로 happy-dom(서버와 같은 환경)을 쓴다.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
