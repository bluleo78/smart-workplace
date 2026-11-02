// 화면별 설정 가이드 콘텐츠 — 문구는 코드 상수로 두어 UI 와 같이 바뀌고 같이 리뷰된다(WP-399).
export interface SettingsGuide {
  /** 화면 이름 — AI 화면 맥락 view(「설정 · 제목」)에 쓴다(WP-414). 페이지 제목은 JSX 일 수 있어 따로 둔다. */
  title: string
  /** 한 줄 소개 — 이 화면에서 무엇을 왜 하는지. */
  lead: string
  /** 알아두기 3~5개 — 섹션 설명과 겹치지 않는 왜·언제·주의. */
  tips: string[]
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

/** 가이드의 할 일 한 단계 — 번호는 title 에 담는다(예: 「② 플러그인 설치」). */
export interface SettingsGuideStep {
  title: string
  /** 한두 문장 지시. */
  body?: string
  /** 값 하나를 복사하는 단추(예: 아이디 복사). 명령 앞에 둔다. */
  copyValue?: { label: string; value: string; testId?: string }
  /** 복사할 명령 — label 은 명령 위 한 줄 설명. */
  commands?: { label?: string; command: string; testId?: string }[]
  /** 기본으로 접어 둘지(예: 「다른 방법」). */
  collapsed?: boolean
}

/** 화면 섹션 하나에 대한 도움말 — id 는 화면 SettingsSection 의 id 와 같다(가이드가 따라갈 기준). */
export interface SettingsGuideSection {
  id: string
  /** 화면 섹션 제목과 같게. */
  title: string
  tips?: string[]
  caution?: string
  /**
   * 그 섹션에서 할 일 순서(WP-1281, 예: 실행 › 외부 연결 방법) — 화면에 두기엔 길고 한 번만 하는 단계. 명령은 복사 단추가 붙은 블록으로 그리고,
   * AI 화면 맥락에는 싣지 않는다(맥락은 소개·알아두기·주의만).
   */
  steps?: SettingsGuideStep[]
  /** steps 묶음 제목 — 없으면 「할 일 순서」. */
  stepsTitle?: string
}
