import { type ClassValue,clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 마지막 음절 받침 유무에 따라 "을"/"를" 반환 */
export function eulReul(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code % 28 > 0 ? '을' : '를';
}

/** 마지막 음절 받침 유무에 따라 "이"/"가" 반환 */
export function iGa(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code % 28 > 0 ? '이' : '가';
}

/** 마지막 음절 받침 유무에 따라 "은"/"는" 반환 */
export function eunNeun(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code % 28 > 0 ? '은' : '는';
}

/** 마지막 음절 받침에 따라 "으로"/"로" 반환 — 받침 없음·ㄹ받침은 "로"(예: 목록으로, 체크리스트로, 파일로) */
export function euroRo(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const jong = code >= 0 ? code % 28 : 0;
  return jong === 0 || jong === 8 ? '로' : '으로';
}

/** 이름 앞의 법인 표기 — (주)·(유)·(재)·(사) 괄호형과 ㈜·㈲ 합자. 이니셜 계산에서만 건너뛴다. */
const LEGAL_ENTITY_PREFIX = /^(?:\([주유재사]\)|[㈜㈲])\s*/u

/**
 * 이름의 첫 글자 — 아바타 이니셜(공백만이거나 비었으면 가운뎃점). 사용자·워크스페이스 아바타가 공유.
 * 조직명은 "(주)아이에이…"처럼 법인 표기·기호로 시작하는 경우가 많아 '(' 가 이니셜이 되던 문제(WP-198)로
 * 앞의 법인 표기를 건너뛰고 첫 문자·숫자를 쓴다. 문자·숫자가 아예 없으면 원래 첫 글자.
 */
export function initialOf(name?: string | null): string {
  const trimmed = name?.trim() ?? ''
  const letter = trimmed.replace(LEGAL_ENTITY_PREFIX, '').match(/[\p{L}\p{N}]/u)?.[0]
  return letter ?? (trimmed.charAt(0) || '·')
}

/** 사용자 표시 이름 — 이름 → 아이디 → '사용자' 순의 대체값(모바일 계정 UI 공용). */
export function displayNameOf(user?: { name?: string | null; username?: string | null } | null): string {
  return user?.name || user?.username || '사용자'
}
