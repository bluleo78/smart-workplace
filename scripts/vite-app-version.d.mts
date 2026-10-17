// vite-app-version.mjs 의 타입 선언 — web·admin 의 vite.config.ts(strict TS)가 .mjs 를 import 할 때 필요하다.
import type { Plugin } from 'vite'

/** vite `define` 에 병합할 빌드 상수(JSON.stringify 된 문자열 리터럴). */
export function appVersionDefine(env?: Record<string, string | undefined>): {
  __APP_VERSION__: string
  __APP_VERSION_LABEL__: string
  __GIT_SHA_SHORT__: string
}

/** 빌드 산출물 루트에 version.json 을 내보내는 플러그인. */
export function versionJsonPlugin(env?: Record<string, string | undefined>): Plugin
