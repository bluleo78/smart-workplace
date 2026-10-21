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

/**
 * 사용자가 정한 이름·검색어 뒤 조사 — 한글 음절로 끝나면 받침에 따라 withJong/noJong 중 하나, 아니면(영문·숫자 등)
 * 받침을 알 수 없어 「이(가)」처럼 둘 다 적는다(WP-647·679).
 */
function nameParticle(name: string, withJong: string, noJong: string, unknown: string) {
  const code = name.charCodeAt(name.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return unknown;
  return (code - 0xac00) % 28 > 0 ? withJong : noJong;
}

/** 이름 뒤 주격 조사 — 이/가, 한글이 아니면 「이(가)」. */
export function subjectParticle(name: string) {
  return nameParticle(name, '이', '가', '이(가)');
}

/** 이름 뒤 목적격 조사 — 을/를, 한글이 아니면 「을(를)」. */
export function objectParticle(name: string) {
  return nameParticle(name, '을', '를', '을(를)');
}

/** 이름·검색어 뒤 접속 조사 — 과/와, 한글이 아니면 「와(과)」. */
export function andParticle(name: string) {
  return nameParticle(name, '과', '와', '와(과)');
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
