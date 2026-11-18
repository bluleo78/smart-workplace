// 메일 상세 머리에 뜨는 수신 일시 표기(WP-1723) — 날짜·시각은 목록 행에만 있고 상세엔 없어
// 열어 둔 메일의 수신 시각을 보려 목록으로 돌아가야 했다. 오늘은 「오늘 HH:mm」, 올해는
// 「M/D (요일) HH:mm」, 그 외는 연도를 붙인다. 요일·연도·오늘 판정은 로컬 Date 기준으로 직접
// 계산해 ICU(toLocale*) 로케일에 흔들리지 않게 한다.
import { parseUtcDate, WEEKDAY_KO } from '@/lib/formatters'

/** 두 자리 고정폭 — 시·분을 HH:mm 으로 (zero-pad). */
const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * 메일 수신(없으면 보낸) 일시 ISO 문자열을 상세 머리 표기로 바꾼다.
 * 값 없음·무효 입력 → '' — 호출부가 빈 문자열이면 시간 줄 자체를 그리지 않는다.
 *
 * @param iso 서버(UTC) 시각 문자열 — `parseUtcDate` 로 파싱한다.
 * @param now '오늘'·'올해' 판정 기준 시각 — 테스트 주입용(생략하면 실제 현재 시각).
 */
export function formatMailHeaderTime(iso: string | null, now?: Date): string {
  if (!iso) return ''
  const received = parseUtcDate(iso)
  if (Number.isNaN(received.getTime())) return ''
  const base = now ?? new Date()
  const clock = `${pad2(received.getHours())}:${pad2(received.getMinutes())}`
  // 요일·오늘 판정은 UTC 메일이어도 parseUtcDate 후 로컬 Date 기준 — 사용자가 보는 지역 날짜로 센다.
  const weekday = WEEKDAY_KO[received.getDay()]
  const isToday =
    received.getFullYear() === base.getFullYear() &&
    received.getMonth() === base.getMonth() &&
    received.getDate() === base.getDate()
  if (isToday) return `오늘 ${clock}`
  const monthDay = `${received.getMonth() + 1}/${received.getDate()} (${weekday}) ${clock}`
  // 올해면 연도 생략, 아니면 연도 붙여 헷갈리지 않게.
  return received.getFullYear() === base.getFullYear() ? monthDay : `${received.getFullYear()}/${monthDay}`
}