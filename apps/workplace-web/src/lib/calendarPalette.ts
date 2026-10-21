// 캘린더/일정 고정 색 팔레트. 키→Tailwind 정적 클래스 매핑(JIT 스캔 가능하도록 리터럴 유지).
// 태그(WP-714)도 같은 팔레트 키를 쓴다 — 칩 모양은 tagChipClass.
// 백엔드 CalendarPalette 와 키 집합 동기화(blue green red amber violet pink teal gray).
export interface PaletteEntry {
  key: string
  label: string
  dotClass: string // 점/스와치 배경
  chipClass: string // 이벤트 칩 배경+글자
  tagChipClass: string // 태그 칩(둥근 테두리+옅은 배경+글자) — 라이트/다크 모두 대비가 서는 톤 (WP-714)
}

const ENTRIES: Record<string, PaletteEntry> = {
  blue: {
    key: 'blue',
    label: '파랑',
    dotClass: 'bg-blue-500',
    chipClass: 'bg-blue-500 text-white',
    tagChipClass: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  },
  green: {
    key: 'green',
    label: '초록',
    dotClass: 'bg-emerald-500',
    chipClass: 'bg-emerald-500 text-white',
    tagChipClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  red: {
    key: 'red',
    label: '빨강',
    dotClass: 'bg-red-500',
    chipClass: 'bg-red-500 text-white',
    tagChipClass: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
  },
  amber: {
    key: 'amber',
    label: '주황',
    dotClass: 'bg-amber-500',
    chipClass: 'bg-amber-500 text-white',
    tagChipClass: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  violet: {
    key: 'violet',
    label: '보라',
    dotClass: 'bg-violet-500',
    chipClass: 'bg-violet-500 text-white',
    tagChipClass: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  },
  pink: {
    key: 'pink',
    label: '분홍',
    dotClass: 'bg-pink-500',
    chipClass: 'bg-pink-500 text-white',
    tagChipClass: 'border-pink-500/40 bg-pink-500/10 text-pink-700 dark:text-pink-300',
  },
  teal: {
    key: 'teal',
    label: '청록',
    dotClass: 'bg-teal-500',
    chipClass: 'bg-teal-500 text-white',
    tagChipClass: 'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  },
  gray: {
    key: 'gray',
    label: '회색',
    dotClass: 'bg-gray-500',
    chipClass: 'bg-gray-500 text-white',
    tagChipClass: 'border-gray-500/40 bg-gray-500/10 text-gray-700 dark:text-gray-300',
  },
}

export const PALETTE_KEYS = Object.keys(ENTRIES)

// 키 해석 — null/미지 키는 blue 로 폴백(레거시 hex 등 안전 처리).
export function resolvePalette(key: string | null | undefined): PaletteEntry {
  return (key && ENTRIES[key]) || ENTRIES.blue
}
