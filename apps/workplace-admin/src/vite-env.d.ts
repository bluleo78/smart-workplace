/// <reference types="vite/client" />

/** 릴리스 버전 — vite.config.ts 의 define 으로 주입된다(Docker 빌드 인자 APP_VERSION, 로컬은 'dev'). */
declare const __APP_VERSION__: string
/** 화면 표기용 버전 — 릴리스 빌드는 `v0.9.0`, 로컬 빌드는 `dev`(scripts/vite-app-version.mjs 가 계산). */
declare const __APP_VERSION_LABEL__: string
/** 커밋 앞 7자리 — 로컬 빌드('dev')는 빈 문자열(scripts/vite-app-version.mjs 가 계산). */
declare const __GIT_SHA_SHORT__: string
