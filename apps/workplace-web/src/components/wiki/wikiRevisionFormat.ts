import { format, isSameDay, subDays } from 'date-fns'

import { formatDateMonthDay, parseUtcDate } from '@/lib/formatters'

import type { WikiRevisionPerson } from '../../types/wiki'

/**
 * 노트 버전 기록(WP-282) 목록·미리보기 바의 표시 문구 — 화면 없이 vitest 로 검증하는 순수 함수 모음.
 * 시각은 모두 브라우저 로컬 시간대 기준이다(목록을 보는 사람의 하루 경계로 묶는다). 서버 문자열은 parseUtcDate 로 읽는다.
 * 시각은 date-fns 'HH:mm'(00~23 zero-pad) — ko-KR Intl 의 hour12:false 는 엔진에 따라 자정을 "24:00" 으로 그릴 수 있어 쓰지 않는다.
 */

/** "HH:mm"(24시간). */
export function revisionTime(iso: string): string {
  return format(parseUtcDate(iso), 'HH:mm')
}

/** 날짜 묶음 머리 — 오늘·어제는 말로, 그 밖엔 "M월 D일"(연도는 붙이지 않는다 — 목록 상한 200개라 대개 올해 안). */
export function revisionDayLabel(iso: string, now: Date = new Date()): string {
  const d = parseUtcDate(iso)
  if (isSameDay(d, now)) return '오늘'
  if (isSameDay(d, subDays(now, 1))) return '어제'
  return formatDateMonthDay(iso)
}

/**
 * 판 이름 — 오늘 판은 "HH:mm 버전", 그 밖엔 날짜 묶음 말을 앞에 붙인다("어제 17:48 버전"·"10월 5일 09:12 버전").
 * 모바일 미리보기 제목·복원 토스트가 쓴다 — 시각만 보이면 어제·그제 판이 오늘 판처럼 읽힌다.
 */
export function revisionVersionLabel(iso: string, now: Date = new Date()): string {
  const day = revisionDayLabel(iso, now)
  const time = revisionTime(iso)
  return day === '오늘' ? `${time} 버전` : `${day} ${time} 버전`
}

/** 미리보기 바 문구 — "{M월 D일 HH:mm} 버전 미리보기 — 읽기 전용". */
export function revisionBarLabel(iso: string): string {
  return `${formatDateMonthDay(iso)} ${revisionTime(iso)} 버전 미리보기 — 읽기 전용`
}

/** 편집자 표시 — 1~2명은 ", " 로 잇고, 3명 이상은 "{첫 사람} 외 {n-1}명". 없으면 빈 문자열. */
export function revisionEditorsLabel(editors: WikiRevisionPerson[]): string {
  if (editors.length <= 2) return editors.map((e) => e.name).join(', ')
  return `${editors[0].name} 외 ${editors.length - 1}명`
}

/**
 * 목록 항목을 로컬 날짜로 묶는다 — 입력 순서(최신순)를 유지하고, 연달아 같은 날인 항목끼리 한 묶음이 된다.
 * at 은 항목의 편집 시각(ISO).
 */
export function groupRevisionsByDay<T>(entries: T[], at: (e: T) => string, now: Date = new Date()): { label: string; entries: T[] }[] {
  const groups: { label: string; entries: T[] }[] = []
  for (const e of entries) {
    const label = revisionDayLabel(at(e), now)
    const last = groups.at(-1)
    if (last && last.label === label) last.entries.push(e)
    else groups.push({ label, entries: [e] })
  }
  return groups
}
