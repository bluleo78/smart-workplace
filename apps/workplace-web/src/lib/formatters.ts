/**
 * 공통 포매터 유틸리티
 * 여러 페이지에서 중복 정의되던 함수들을 통합.
 *
 * 날짜/시간 표시는 반드시 이 파일의 포매터를 거친다 — 화면에서 `toLocale*String` 직접 호출은
 * ESLint(no-restricted-syntax)로 금지(#632). 용도별 선택 기준은 docs/CODING_CONVENTION.md
 * "날짜/시간 표시 포맷" 표 참조. 이 파일만 규칙 예외.
 */

/** 타임존 정보가 이미 붙어 있는지 판별 — 'Z' 또는 ±HH:MM / ±HHMM 오프셋(#617). */
const TZ_SUFFIX_RE = /Z$|[+-]\d{2}:?\d{2}$/;

/** 서버(UTC)에서 받은 LocalDateTime 문자열에 'Z'를 붙여 UTC로 파싱.
 *  null/undefined/빈 문자열 입력 시 Invalid Date(new Date(NaN))를 반환해 호출부가 NaN 가드로 처리.
 *
 *  #617 회귀 레퍼런스: 오프셋 판별이 콜론 없는 형식(+0900)만 인식해 OffsetDateTime 직렬화(+09:00)에
 *  'Z'를 중복 append → Invalid Date → 화면에 '-' 표시. 콜론 포함/미포함 모두 인식해야 한다.
 */
export function parseUtcDate(dateStr: string | null | undefined): Date {
  // null/undefined/빈 문자열은 Invalid Date 반환 — 호출부에서 Number.isNaN(d.getTime())으로 처리
  if (!dateStr) return new Date(NaN);
  // 이미 타임존 정보가 있으면 그대로, 없으면 UTC로 간주
  if (TZ_SUFFIX_RE.test(dateStr)) return new Date(dateStr);
  return new Date(dateStr + 'Z');
}

/**
 * ko-KR 로케일 표기 공통 경로 — 파싱 후 무효 입력(null/undefined 포함)이면 '-', 아니면 render 결과(#828).
 * 로케일 표기 포매터들이 같은 가드를 반복하지 않도록 모은다.
 */
function formatLocaleOrDash(dateStr: string | null | undefined, render: (d: Date) => string): string {
  const d = parseUtcDate(dateStr);
  return Number.isNaN(d.getTime()) ? '-' : render(d);
}

/**
 * 로케일 날짜 — "2026. 7. 15." (브라우저 로컬 타임존). 신규 목록/테이블은 `formatDateOnly`(YYYY-MM-DD)를 우선 사용.
 * 기존 화면(UserDetailPage·토큰 설정/발급·드라이브 휴지통 삭제 예정일)의 표기 유지용(#828). null/undefined/무효 입력 → '-'.
 */
export function formatDateShort(dateStr: string | null | undefined): string {
  return formatLocaleOrDash(dateStr, (d) => d.toLocaleDateString('ko-KR'));
}

/**
 * 한국어 로케일 전체 일시 — "2026. 7. 15. 오후 2:30:00" (브라우저 로컬 타임존).
 * `toLocaleString('ko-KR')` 표기를 쓰던 기존 화면(토큰 설정·에이전트 관리·드라이브 버전 이력)의
 * 표기를 유지하기 위한 포매터(#828). 신규 코드는 `formatDateTime`(YYYY-MM-DD HH:mm:ss)을 우선 사용.
 * null/undefined/무효 입력 → '-'.
 */
export function formatDateTimeLocale(dateStr: string | null | undefined): string {
  return formatLocaleOrDash(dateStr, (d) => d.toLocaleString('ko-KR'));
}

/**
 * 월·일 2자리 — "07. 15." (브라우저 로컬 타임존). 메일 목록처럼 폭이 일정해야 하는 좁은 컬럼용(#828).
 * null/undefined/무효 입력 → '-'.
 */
export function formatDateMonthDayPadded(dateStr: string | null | undefined): string {
  return formatLocaleOrDash(dateStr, (d) => d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }));
}

/** 월·일만("8월 12일") — 좁은 칩/배지용. 무효 입력이면 빈 문자열(호출부가 세그먼트 생략). */
export function formatDateMonthDay(dateStr: string | null | undefined): string {
  const d = parseUtcDate(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(d);
}

/**
 * 날짜만 표시 — `YYYY-MM-DD` zero-pad (이슈 #105).
 * `formatDateShort`는 로케일 의존이라 페이지 간 표시가 들쭉날쭉하여 별도 zero-pad 헬퍼 도입.
 */
export function formatDateOnly(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = parseUtcDate(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 날짜 전용 ISO 문자열(YYYY-MM-DD)을 한국어 로케일로 포매팅.
 * ex) "2026-06-30" → "2026년 6월 30일"
 * 타임존 왜곡 방지를 위해 UTC 파싱 없이 로컬 날짜로 직접 생성.
 */
export function formatDateKorean(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return '-';
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return '-';
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** 두 자리 zero-pad. */
function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * 절대시간 포맷 — `YYYY-MM-DD HH:mm:ss` (KST).
 * 페이지 간 일관성 확보를 위한 공통 포맷터 (이슈 #105).
 * - 모든 자릿수 zero-pad
 * - 로컬 타임존 기준 (KST)
 * - null/undefined → '-'
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = parseUtcDate(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

/**
 * 절대시간 포맷(분 단위) — `YYYY-MM-DD HH:mm` (KST).
 * 목록 화면의 hover 툴팁에 적합 (초 단위 정밀도 불필요).
 */
export function formatDateTimeMinute(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const full = formatDateTime(dateStr);
  if (full === '-') return '-';
  return full.slice(0, 16);
}

/**
 * 상대시간 포맷 — `방금 전`, `5분 전`, `3시간 전`, `2일 전`, `3개월 전`.
 * 페이지 간 일관성 확보를 위한 공통 포맷터 (이슈 #105).
 * UTC 파싱(parseUtcDate)을 사용하여 서버 LocalDateTime 문자열을 정확히 처리.
 * (같은 출력의 `timeAgo`·`formatElapsedTime` 은 미사용 중복이라 #632 에서 제거.)
 */
export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = parseUtcDate(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}개월 전`;
  const years = Math.floor(months / 12);
  return `${years}년 전`;
}

/**
 * IPv4/IPv6 주소를 사용자 친화적 형태로 변환 (이슈 #106).
 * - IPv6 loopback `0:0:0:0:0:0:0:1` 또는 `::1` → `localhost`
 * - IPv4 loopback `127.0.0.1` → `localhost`
 * - 그 외는 원본 유지
 * - null/undefined/빈문자열 → '-'
 */
export function formatIpAddress(ip: string | null | undefined): string {
  if (!ip) return '-';
  const trimmed = ip.trim();
  if (trimmed === '') return '-';
  // IPv6 loopback (raw 형태와 압축 형태 모두 처리)
  if (trimmed === '0:0:0:0:0:0:0:1' || trimmed === '::1') return 'localhost';
  if (trimmed === '127.0.0.1') return 'localhost';
  return trimmed;
}

/**
 * 데이터셋 타입 enum → 한글 라벨 (이슈 #107).
 * 사용자 화면에서는 영문 enum이 노출되지 않도록 매핑.
 */
export function getDatasetTypeLabel(type: string): string {
  switch (type) {
    case 'SOURCE':
      return '원본';
    case 'DERIVED':
      return '파생';
    case 'TEMP':
      return '임시';
    default:
      return type;
  }
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function isNullValue(value: unknown): boolean {
  return value === null || value === undefined;
}

export function getRawCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function formatCellValue(value: unknown, dataType?: string): string {
  if (value === null || value === undefined) return 'NULL';

  if (dataType === 'BOOLEAN' || typeof value === 'boolean') {
    const boolVal = typeof value === 'boolean' ? value : value === 'true';
    // 이모지(✓/✗) 대신 텍스트 — formatCellValue 는 string 반환 계약이라 아이콘 사용 불가.
    return boolVal ? '예' : '아니오';
  }

  const str = String(value);

  if (dataType === 'DATE') {
    return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(str));
  }

  if (dataType === 'TIMESTAMP' || ISO_DATETIME_RE.test(str)) {
    return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(str));
  }

  if (str.length > 200) {
    return str.slice(0, 200) + '…';
  }

  return str;
}

/**
 * KST 기준 날짜 키를 반환한다 (YYYY-MM-DD 형식).
 * 채팅 날짜 구분선 삽입 시 인접 메시지의 날짜 비교에 사용된다(이슈 #338).
 */
export function getDateKey(dateStr: string): string {
  const d = parseUtcDate(dateStr);
  // en-CA 로케일은 YYYY-MM-DD 형식을 안정적으로 반환
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'info';

/** StatusBadge type 토큰 (components/ui/status-badge와 동일 정의 — 순환 import 회피용 별칭). */
export type StatusBadgeType =
  | 'active'
  | 'inactive'
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'pending'
  | 'unknown';

/**
 * 실행 상태(JobExecution / Pipeline / Import) → StatusBadge type 매핑.
 * 의미↔색 통일 (이슈 #68): 완료=success, 실패=error, 실행중=info, 취소/건너뜀=inactive, 대기=pending.
 */
export function getExecutionStatusType(status: string): StatusBadgeType {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'error';
    case 'RUNNING':
    case 'PROCESSING':
      return 'info';
    case 'PENDING':
      return 'pending';
    case 'CANCELLED':
    case 'SKIPPED':
      return 'inactive';
    default:
      return 'unknown';
  }
}

/**
 * 실행 상태(JobExecution / Pipeline / Import) → Badge variant 매핑.
 *
 * 의미 ↔ 색 매핑은 앱 전체에서 통일되어야 한다 (이슈 #68):
 * - 완료/성공 → success(녹색)
 * - 실패/오류 → destructive(빨강)
 * - 실행중/처리중 → info(파랑)
 * - 취소/건너뜀 → secondary(회색)
 * - 대기/그 외 → outline
 *
 * 신규 코드는 가능하면 `<StatusBadge type="..." />` (components/ui/status-badge)를 사용한다.
 * 이 함수는 기존 호출부 backward compat용으로 유지한다.
 */
export function getStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'destructive';
    case 'RUNNING':
    case 'PROCESSING':
      return 'info';
    case 'CANCELLED':
    case 'SKIPPED':
      return 'secondary';
    default:
      return 'outline';
  }
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    COMPLETED: '완료',
    FAILED: '실패',
    RUNNING: '실행중',
    PROCESSING: '처리중',
    PENDING: '대기',
    CANCELLED: '취소됨',
    SKIPPED: '건너뜀',
  };
  return labels[status] || status;
}

/**
 * 두 시점 사이의 경과 시간을 사람이 읽기 쉬운 형태로 반환한다.
 * completedAt이 null이면 "-"를 반환한다.
 * 예: "45초", "2분 30초", "1시간 5분"
 */
export function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '-';
  const diffMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (diffMs < 0) return '-';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return remainSec > 0 ? `${minutes}분 ${remainSec}초` : `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `${hours}시간 ${remainMin}분` : `${hours}시간`;
}

/**
 * 메시지 거품용 시각 — `오전/오후 H:mm` (KST). 채팅 타임스탬프에 사용.
 * parseUtcDate 로 서버 LocalDateTime(UTC) 을 정확히 파싱하고, timeZone 을 Asia/Seoul 로 고정해
 * CI 로케일/타임존에 비의존하도록 한다.
 */
export function formatClockTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = parseUtcDate(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Seoul',
  }).format(d);
}

/**
 * 컴팩트 시각(24시간 "HH:mm") — 채팅 메시지 좌측 거터의 hover 시각용.
 * 오전/오후 접두어가 없어 좁은 거터(40px)에 한 줄로 들어간다(줄바꿈→박스 점프 방지).
 */
export function formatClockTimeCompact(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = parseUtcDate(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
  }).format(d);
}

/**
 * 컴팩트 시각(24시간 "HH:mm") — 브라우저 로컬 타임존 기준(#828).
 * `formatClockTimeCompact` 와 표기는 같지만 타임존을 고정하지 않는다 — 캘린더 화면은 날짜 판정·배치를
 * 모두 로컬 타임존으로 하므로 시각만 Asia/Seoul 로 고정하면 비-KST 사용자에게 날짜/시각이 어긋난다.
 * 홈 캘린더/일정 위젯처럼 로컬 날짜와 함께 쓰는 곳에 사용. null/undefined/무효 입력 → '-'.
 */
export function formatLocalClockTime24(dateStr: string | null | undefined): string {
  return formatLocaleOrDash(dateStr, (d) => d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }));
}

/**
 * 시각 2자리 12시간제 — "오후 02:30" (브라우저 로컬 타임존, #828).
 * 시(時)가 zero-pad 되어 폭이 일정 — 캘린더 타임그리드/아젠다, 메일 목록(오늘 수신)용.
 * `formatClockTime`("오후 2:30", Asia/Seoul 고정)과 달리 zero-pad·로컬 타임존. null/undefined/무효 입력 → '-'.
 */
export function formatClockTimePadded(dateStr: string | null | undefined): string {
  return formatLocaleOrDash(dateStr, (d) => d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
}

/**
 * 숫자 천단위 구분 — 9007199254740991 → "9,007,199,254,740,991" (#828).
 * 표시 전용(입력 파싱에는 사용하지 않는다). 날짜가 아니지만 `toLocaleString` 직접 호출이
 * 린트 규칙(구문 기반)에 걸리므로 이 파일에 둔다.
 */
export function formatNumber(n: number): string {
  return n.toLocaleString('ko-KR');
}

// 날짜 비교·표기 기준 타임존 — 기존 formatClockTime 과 같은 Asia/Seoul 고정(CI 타임존 비의존).
const LIST_TZ = 'Asia/Seoul'
// 표기 문구는 ICU 로케일 데이터(small-icu 에선 ko 누락 → "PM 1:05")에 기대지 않고, 숫자 부품만 뽑아 직접 조립한다.
const listTimeParts = new Intl.DateTimeFormat('en-US', {
  timeZone: LIST_TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
})

type Ymdhm = { y: number; m: number; d: number; h: number; min: number }

/** Asia/Seoul 기준 연·월·일·시·분 숫자 부품. */
function kstParts(date: Date): Ymdhm {
  const o: Record<string, number> = {}
  for (const p of listTimeParts.formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value)
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
