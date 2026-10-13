// WP-55 AI 메모리 공용 규칙 — 서버 오류 코드(ErrorResponse.errors.code) 해석과 사용자 문구.
// handleApiError 는 errors 의 첫 값(코드 문자열)을 토스트로 띄우므로 메모리 오류는 이 코드로 문구를 고른다.
import axios from 'axios';

import { extractApiError } from '@/lib/api-error';
import type { ErrorResponse } from '@/types/auth';

/** 되돌릴 대상이 이미 없을 때(GONE·NOT_FOUND). */
export const UNDO_GONE_MESSAGE = '이미 지워진 메모리예요';
/** 고침 되돌리기 — 그 고침 뒤에 메모리가 또 바뀌어 서버가 덮지 않고 거절했을 때(AI_MEMORY_CHANGED). */
export const UNDO_CHANGED_MESSAGE = '그 뒤에 바뀐 메모리라 되돌리지 않았어요';
/** 지움 되돌리기가 상한(50)에 걸렸을 때 — 토스트 action "설정 열기". */
export const UNDO_FULL_MESSAGE = '메모리가 가득 찼어요. 설정에서 정리해 주세요';
/** 가득 참 토스트의 이동 경로. */
export const MEMORY_SETTINGS_PATH = '/settings/assistant';

/** 서버 메모리 오류 코드(AI_MEMORY_*) — 없으면 null. */
export function memoryErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const code = (error.response?.data as ErrorResponse | undefined)?.errors?.code;
  return typeof code === 'string' ? code : null;
}

/** 사용자당 상한(서버 AiMemoryService.LIMIT 과 같다). */
export const MEMORY_LIMIT = 50;
/** 내용 상한(코드포인트, 서버 MAX_CHARS 와 같다). */
export const MEMORY_MAX_CHARS = 300;
/** 이 개수부터 목록 카운트를 주황으로(곧 가득 참). */
export const MEMORY_WARN_AT = 45;

/** 앞뒤 공백을 지운 코드포인트 수 — 서버 normalizeContent 와 같은 기준(이모지 1개 = 1자). */
export function memoryLength(s: string): number {
  return [...s.trim()].length;
}

/** 저장 가능한 내용인가(1~300자). 넘으면 자르지 않고 버튼만 막는다. */
export function canSubmitContent(s: string): boolean {
  const n = memoryLength(s);
  return n >= 1 && n <= MEMORY_MAX_CHARS;
}

/** 내용 카운트(n / 300) 색 — 초과면 빨강. */
export function contentCountTone(len: number): string {
  return len > MEMORY_MAX_CHARS ? 'text-destructive' : 'text-muted-foreground';
}

/** 목록 카운트(n / 50) 색 — 45개부터 주황. */
export function listCountTone(count: number): string {
  return count >= MEMORY_WARN_AT ? 'text-warning-text' : 'text-muted-foreground';
}

/** 저장 실패 문구 — 메모리 오류 코드가 있으면 서버 문구(errors 의 코드 문자열 대신), 아니면 공용 추출 규칙. */
export function memoryErrorMessage(error: unknown, fallback: string): string {
  if (memoryErrorCode(error) && axios.isAxiosError(error)) {
    const message = (error.response?.data as ErrorResponse | undefined)?.message;
    if (message) return message;
  }
  return extractApiError(error, fallback);
}
