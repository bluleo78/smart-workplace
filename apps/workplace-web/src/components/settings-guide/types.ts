// 화면별 설정 가이드 콘텐츠 — 문구는 코드 상수로 두어 UI 와 같이 바뀌고 같이 리뷰된다(WP-399).
export interface SettingsGuide {
  /** 화면 이름 — AI 화면 맥락 view(「설정 · 제목」)에 쓴다(WP-414). 페이지 제목은 JSX 일 수 있어 따로 둔다. */
  title: string
  /** 한 줄 소개 — 이 화면에서 무엇을 왜 하는지. */
  lead: string
  /**
   * 알아두기 — 섹션 설명과 겹치지 않는 왜·언제·주의. sections 가 있으면 여러 섹션에 걸치는 화면 전체의 말만 두고(없으면 생략),
   * 한 섹션에만 해당하는 말은 그 섹션에 둔다(WP-1298 — 같은 말을 두 곳에 두면 가이드와 AI 화면 맥락에 두 번 실린다).
   */
  tips?: string[]
  /** 주의(있을 때만) — 되돌리기 어려운 동작 경고. */
  caution?: string
  /**
   * 화면 섹션별 도움말(WP-1281) — 있으면 소개 아래에 섹션마다 묶어 그리고, 본문에서 보고 있는 섹션(같은 id)으로 가이드가 따라간다.
   * 없으면 예전처럼 알아두기·주의 한 덩어리(하위 호환).
   */
  sections?: SettingsGuideSection[]
  /** 관련 화면 — 앱 내부 경로만. */
  related?: { label: string; to: string }[]
}

/** 화면 섹션 하나에 대한 도움말 — id 는 화면 SettingsSection 의 id 와 같다(가이드가 따라갈 기준). */
export interface SettingsGuideSection {
  id: string
  /** 화면 섹션 제목과 같게. */
  title: string
  tips?: string[]
  caution?: string
}
