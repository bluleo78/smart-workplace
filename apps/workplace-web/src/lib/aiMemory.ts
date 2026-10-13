// WP-55 AI 메모리 공용 규칙 — 서버 오류 코드(ErrorResponse.errors.code) 해석과 사용자 문구.
// handleApiError 는 errors 의 첫 값(코드 문자열)을 토스트로 띄우므로 메모리 오류는 이 코드로 문구를 고른다.
import axios from 'axios';

import type { ErrorResponse } from '@/types/auth';

/** 되돌릴 대상이 이미 없을 때(GONE·NOT_FOUND). */
export const UNDO_GONE_MESSAGE = '이미 지워진 메모리예요';
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
