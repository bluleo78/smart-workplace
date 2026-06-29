// 위키 변형 계열 AI 액션(선택영역 제자리 교체)의 메타데이터·프리셋 단일 원천.
// 생성 계열(summarize/draft/continue, 슬래시 메뉴)과 분리 — 이쪽은 플로팅 툴바에서 노출된다.

/** 톤 변경 프리셋 — value 는 프롬프트로 전송(prompt), label 은 UI 표기. */
export const TONE_PRESETS = [
  { value: '격식체', label: '격식' },
  { value: '캐주얼', label: '캐주얼' },
  { value: '간결체', label: '간결' },
  { value: '전문적', label: '전문' },
] as const

/** 번역 대상 언어 프리셋. */
export const LANGUAGE_PRESETS = [
  { value: '영어', label: '영어' },
  { value: '한국어', label: '한국어' },
  { value: '일본어', label: '일본어' },
  { value: '중국어', label: '중국어' },
] as const

export type TransformActionKey = 'rewrite_tone' | 'translate' | 'expand' | 'condense' | 'polish'

/** 툴바 노출용 변형 액션 서술자. param 이 있으면 드롭다운으로 프리셋을 고른 뒤 실행. */
export interface TransformActionDescriptor {
  key: TransformActionKey
  label: string
  param: 'tone' | 'language' | null
}

export const TRANSFORM_ACTIONS: TransformActionDescriptor[] = [
  { key: 'rewrite_tone', label: '톤', param: 'tone' },
  { key: 'translate', label: '번역', param: 'language' },
  { key: 'expand', label: '확장', param: null },
  { key: 'condense', label: '축약', param: null },
  { key: 'polish', label: '다듬기', param: null },
]

