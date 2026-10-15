// 화면별 설정 가이드 콘텐츠 — 문구는 코드 상수로 두어 UI 와 같이 바뀌고 같이 리뷰된다(WP-399).
export interface SettingsGuide {
  /** 한 줄 소개 — 이 화면에서 무엇을 왜 하는지. */
  lead: string
  /** 알아두기 3~5개 — 섹션 설명과 겹치지 않는 왜·언제·주의. */
  tips: string[]
  /** 주의(있을 때만) — 되돌리기 어려운 동작 경고. */
  caution?: string
  /** 관련 화면 — 앱 내부 경로만. */
  related?: { label: string; to: string }[]
}
