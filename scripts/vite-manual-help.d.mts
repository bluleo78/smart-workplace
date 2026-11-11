// vite-manual-help.mjs 의 타입 선언 — web 의 vite.config.ts(strict TS)가 .mjs 를 import 할 때 필요하다(WP-1504).
import type { Plugin } from 'vite'

/** 웹 산출물 안 묶음 루트 폴더(`help` → `/help/manual-index.json`). */
export const MANUAL_HELP_BASE: string

/** 웹 이미지 빌드가 COPY 해야 하는 저장소 경로 목록(테스트가 Dockerfile 과 대조). */
export const MANUAL_HELP_INPUTS: string[]

/** 매뉴얼 도움말 묶음을 /help/ 정적 파일로 싣는 플러그인. root 는 테스트용 저장소 루트 바꾸기. */
export function manualHelpPlugin(options?: { book?: 'user'; root?: string }): Plugin
