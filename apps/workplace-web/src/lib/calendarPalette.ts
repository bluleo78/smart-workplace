// 캘린더/일정 고정 색 팔레트. 키→Tailwind 정적 클래스 매핑(JIT 스캔 가능하도록 리터럴 유지).
// 백엔드 CalendarPalette 와 키 집합 동기화(blue green red amber violet pink teal gray).
export interface PaletteEntry {
  key: string
  label: string
  dotClass: string // 점/스와치 배경
  chipClass: string // 이벤트 칩 배경+글자
}

const ENTRIES: Record<string, PaletteEntry> = {
  blue: { key: 'blue', label: '파랑', dotClass: 'bg-blue-500', chipClass: 'bg-blue-500 text-white' },
  green: { key: 'green', label: '초록', dotClass: 'bg-emerald-500', chipClass: 'bg-emerald-500 text-white' },
  red: { key: 'red', label: '빨강', dotClass: 'bg-red-500', chipClass: 'bg-red-500 text-white' },
  amber: { key: 'amber', label: '주황', dotClass: 'bg-amber-500', chipClass: 'bg-amber-500 text-white' },
  violet: { key: 'violet', label: '보라', dotClass: 'bg-violet-500', chipClass: 'bg-violet-500 text-white' },
  pink: { key: 'pink', label: '분홍', dotClass: 'bg-pink-500', chipClass: 'bg-pink-500 text-white' },
  teal: { key: 'teal', label: '청록', dotClass: 'bg-teal-500', chipClass: 'bg-teal-500 text-white' },
  gray: { key: 'gray', label: '회색', dotClass: 'bg-gray-500', chipClass: 'bg-gray-500 text-white' },
}

export const PALETTE_KEYS = Object.keys(ENTRIES)

// 키 해석 — null/미지 키는 blue 로 폴백(레거시 hex 등 안전 처리).
export function resolvePalette(key: string | null | undefined): PaletteEntry {
  return (key && ENTRIES[key]) || ENTRIES.blue
}
