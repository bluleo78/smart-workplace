// 모바일 채팅 목록 행(WP-135)의 시간·미리보기 문구 규칙. 화면과 분리해 단위 테스트한다.
import type { LastMessageSummary } from '@/types/messaging'

import { parseUtcDate } from './formatters'

/** 메시지가 하나도 없는 대화의 미리보기 자리 문구. */
export const EMPTY_PREVIEW = '아직 메시지가 없습니다'

// 날짜 비교·표기 기준 타임존 — 기존 formatClockTime 과 같은 Asia/Seoul 고정(CI 타임존 비의존).
const TZ = 'Asia/Seoul'
// 표기 문구는 ICU 로케일 데이터(small-icu 에선 ko 누락 → "PM 1:05")에 기대지 않고, 숫자 부품만 뽑아 직접 조립한다.
const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
})

type Ymdhm = { y: number; m: number; d: number; h: number; min: number }

/** Asia/Seoul 기준 연·월·일·시·분 숫자 부품. */
function kstParts(date: Date): Ymdhm {
  const o: Record<string, number> = {}
  for (const p of parts.formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, min: o.minute }
}

const sameDay = (a: Ymdhm, b: Ymdhm) => a.y === b.y && a.m === b.m && a.d === b.d

/**
 * 목록 행 오른쪽 시간 — 오늘은 시각, 어제는 "어제", 올해는 "M월 D일", 그 이전은 "YYYY. M. D.".
 * 메신저 목록 관례(최근일수록 정밀). 무효 입력이면 빈 문자열(칸을 비운다).
 */
export function formatListTime(at: string, now: Date = new Date()): string {
  const date = parseUtcDate(at)
  if (Number.isNaN(date.getTime())) return ''
  const t = kstParts(date)
  const n = kstParts(now)
  if (sameDay(t, n)) {
    const h12 = t.h % 12 === 0 ? 12 : t.h % 12
    return `${t.h < 12 ? '오전' : '오후'} ${h12}:${String(t.min).padStart(2, '0')}`
  }
  // Asia/Seoul 은 DST 가 없으므로 24시간 전의 날짜 = 어제.
  if (sameDay(t, kstParts(new Date(now.getTime() - 86_400_000)))) return '어제'
  if (t.y === n.y) return `${t.m}월 ${t.d}일`
  return `${t.y}. ${t.m}. ${t.d}.`
}

/**
 * 목록 행 미리보기 한 줄 — 내 메시지는 "나: ", 1:1 DM 상대 메시지는 접두 없음(누가 보냈는지 자명),
 * 채널·그룹 DM 은 "이름: ". 작성자 이름을 모르면 접두를 생략한다.
 */
export function previewLine(
  last: LastMessageSummary | null | undefined,
  opts: { meId: number; isOneToOneDm: boolean },
): string {
  if (!last) return EMPTY_PREVIEW
  if (last.authorId === opts.meId) return `나: ${last.preview}`
  if (opts.isOneToOneDm || !last.authorName) return last.preview
  return `${last.authorName}: ${last.preview}`
}
