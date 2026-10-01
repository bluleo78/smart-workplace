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

/** 이름의 첫 글자 — 아바타 이니셜(공백만이거나 비었으면 가운뎃점). 사용자·워크스페이스 아바타가 공유. */
export function initialOf(name?: string | null): string {
  return name?.trim().charAt(0) || '·'
}

/** 사용자 표시 이름 — 이름 → 아이디 → '사용자' 순의 대체값(모바일 계정 UI 공용). */
export function displayNameOf(user?: { name?: string | null; username?: string | null } | null): string {
  return user?.name || user?.username || '사용자'
}
