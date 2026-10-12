import { type ClassValue,clsx } from "clsx"
import { format } from "date-fns"
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

/** ISO 일시를 yyyy-MM-dd 로 표시한다 — 파싱 불가 값은 원문 그대로 돌려준다. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, 'yyyy-MM-dd')
}
