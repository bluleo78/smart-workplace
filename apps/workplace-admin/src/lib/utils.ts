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

/** 시간대 표기(Z·±hh:mm)로 끝나는지 — 없는 값은 API 의 시간대 없는 TIMESTAMP(UTC 벽시계) 다. */
const TZ_SUFFIX_RE = /Z$|[+-]\d{2}:?\d{2}$/

/**
 * ISO 일시를 브라우저 시간대의 yyyy-MM-dd 로 표시한다 — 파싱 불가 값은 원문 그대로 돌려준다.
 * 시간대 표기가 없으면 UTC 로 읽는다(WP-939, 웹 앱 parseUtcDate 와 같은 규칙). 브라우저 시간으로 읽으면 KST 오전 9시 전 값이 전날로 보인다.
 */
export function formatDate(iso: string): string {
  const d = new Date(TZ_SUFFIX_RE.test(iso) ? iso : `${iso}Z`)
  return Number.isNaN(d.getTime()) ? iso : format(d, 'yyyy-MM-dd')
}
