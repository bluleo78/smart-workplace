/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/** E2E(Playwright) 빌드 여부 — vite.config.ts 의 define 으로 주입된다(운영 빌드에선 false 로 접혀 관련 코드가 빠진다). */
declare const __E2E__: boolean
