// 지시 편집 창(WP-2092)이 지시를 적용할 수 없는 까닭 판정 — 컴포넌트 파일(NodeInstructionEditor)과 나눠 둔 순수 모듈(Fast Refresh 규칙).
import type { NodeDetail } from './graphYaml'
import { NODE_FIELDS } from './nodeFields'

/**
 * 지시 편집 창을 연 노드 — 창을 띄우는 쪽(그래프 편집기)이 든다. 이름·유형·지시는 연 때의 값
 * (노드가 사라져도 창 제목·기준 글로 쓰고, 같은 키로 돌아온 노드가 같은 노드인지 가리는 데 쓴다).
 */
export interface InstructionEditorTarget {
  nodeKey: string
  nodeName: string
  nodeType: string
  text: string
}

/** 지시를 적용할 수 없는 까닭별 창 안내 — 노드 사라짐(키 바뀜·삭제)·YAML 문법 오류·지시를 받지 않는 유형·같은 키의 다른 노드 */
export const INSTRUCTION_LOCK_NOTICE = {
  gone: '이 노드가 사라져 적용할 수 없어요 — 고친 글을 복사해 두세요',
  syntax: 'YAML 문법 오류로 잠시 적용할 수 없어요 — 고치면 다시 적용할 수 있어요',
  type: '이 노드 유형은 지시를 받지 않아 적용할 수 없어요',
  other: '같은 키의 다른 노드가 생겨 적용할 수 없어요',
} as const

export type InstructionLockReason = keyof typeof INSTRUCTION_LOCK_NOTICE

/**
 * 지시를 적용할 수 없는 까닭(없으면 null) — 문법 오류 → 노드 없음 → 지시를 받지 않는 유형 → 같은 키의 다른 노드 순으로 본다.
 * 「다른 노드」는 창을 연 뒤 노드를 한 번이라도 못 찾았을 때(lost)만 본다 — 계속 있던 노드는 AI 가 이름만 고쳐도 잠기지 않게.
 */
export function lockReason({ syntaxError, detail, lost, target }: {
  syntaxError: boolean
  detail: NodeDetail | null
  lost: boolean
  target: InstructionEditorTarget
}): InstructionLockReason | null {
  if (syntaxError) return 'syntax'
  if (detail === null) return 'gone'
  if (!NODE_FIELDS[detail.type]?.has('instructions')) return 'type'
  if (lost && (detail.type !== target.nodeType || (detail.name ?? target.nodeKey) !== target.nodeName)) return 'other'
  return null
}
