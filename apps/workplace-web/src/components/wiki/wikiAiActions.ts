// 위키 AI 액션(생성 계열 + 변형 계열)의 메타데이터·프리셋 단일 원천.
// - 생성 계열(summarize/draft/continue): 슬래시 메뉴 + 헤더 AI 버튼에서 노출
// - 변형 계열(톤/번역/확장/축약/다듬기): 선택영역 버블 툴바에서 노출(제자리 교체)

/** 생성 계열 액션 키 — 백엔드 WikiAiAction 와이어 값(소문자). */
export type GenerateActionKey = 'summarize' | 'draft' | 'continue'

/** 생성 계열 액션 서술자. hint 는 헤더 드롭다운의 부가 설명(슬래시 메뉴는 label 만 사용). */
export interface GenerateActionDescriptor {
  key: GenerateActionKey
  label: string
  hint: string
}

/**
 * 생성 계열 3종 단일 원천 — 슬래시 메뉴(wikiSlashSuggestion)와 헤더 AI 버튼(WikiPageHeader)이
 * 함께 소비한다. 두 곳에 라벨을 중복 정의하면 문구가 드리프트하므로 여기서만 정의한다.
 */
export const GENERATE_ACTIONS: GenerateActionDescriptor[] = [
  { key: 'summarize', label: 'AI 요약', hint: '문서 내용을 요약해 커서 위치에 삽입' },
  { key: 'draft', label: 'AI 초안', hint: '주제를 입력하면 초안을 작성' },
  { key: 'continue', label: 'AI 이어쓰기', hint: '앞 문맥을 이어서 계속 작성' },
]

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

