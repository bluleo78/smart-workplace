// 지시 편집 창(WP-2092)이 지시를 적용할 수 없는 까닭 판정 — 컴포넌트 파일(NodeInstructionEditor)과 나눠 둔 순수 모듈(Fast Refresh 규칙).
import type { NodeDetail } from './graphYaml'
import { NODE_FIELDS } from './nodeFields'

/**
 * 지시 편집 창의 노드 — 연 때의 값으로 시작하고, 창이 적용할 수 있는 동안엔 마지막으로 본 노드 값으로 갱신된다
 * (노드가 사라져도 창 제목·기준 글·공통 지시 목록으로 쓰고, 같은 키로 돌아온 노드가 같은 노드인지 가리는 데 쓴다).
 */
export interface InstructionEditorTarget {
  nodeKey: string
  nodeName: string
  nodeType: string
  text: string
  /** 이 노드가 함께 받는 공통 지시 이름들을 줄바꿈으로 이은 키 — 문자열이라 비교가 싸고, 편집기는 공통 지시 목록을 만들 때 한 번만 나눈다 */
  useKey: string
}

/** 지금 노드(detail)의 창 대상 값 — 창을 열 때와, 적용할 수 있는 동안 「마지막으로 본 노드」를 갱신할 때 쓴다. */
export function targetOf(nodeKey: string, detail: NodeDetail): InstructionEditorTarget {
  return { nodeKey, nodeName: detail.name ?? nodeKey, nodeType: detail.type, text: detail.instructions ?? '', useKey: detail.use.join('\n') }
}

/** 두 대상 값이 같은가 — 마지막으로 본 노드를 갱신할지 가린다(같으면 상태를 바꾸지 않아 렌더가 멈춘다). */
export function sameTarget(a: InstructionEditorTarget, b: InstructionEditorTarget): boolean {
  return a.nodeKey === b.nodeKey && a.nodeName === b.nodeName && a.nodeType === b.nodeType && a.text === b.text && a.useKey === b.useKey
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
 * target 은 마지막으로 본(적용할 수 있던) 노드다 — 연 때의 값에 머물면 있는 동안 이름이 바뀐 노드가 잠깐 사라졌다 돌아올 때 다른 노드로 잠긴다.
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
  if (lost) {
    // 이름의 기본값(이름 없으면 키)은 targetOf 와 같은 규칙으로 — 따로 쓰면 둘이 어긋날 수 있다
    const now = targetOf(target.nodeKey, detail)
    if (now.nodeType !== target.nodeType || now.nodeName !== target.nodeName) return 'other'
  }
  return null
}

/** 잠김 추적 상태 — 마지막으로 본(적용할 수 있던) 노드와, 그 뒤 노드를 못 찾은 적이 있는가 */
export interface TargetTrack {
  last: InstructionEditorTarget
  lost: boolean
}

/**
 * 잠김 추적의 한 걸음(순수 전이) — 지금 YAML 에서 읽은 노드(detail)로 다음 상태와 잠김 까닭을 낸다.
 * - 노드를 못 찾으면(문법 오류 포함) lost 를 세운다 — 그 뒤 같은 키로 돌아온 노드는 last 와 유형·이름이 같아야 풀린다.
 * - 풀린(lock null) 동안엔 last 를 지금 노드로 따라가고 lost 를 내린다 — 있는 동안 이름이 바뀌어도 다음 사라짐·돌아옴에서 잠기지 않게.
 * 바뀐 것이 없으면 들어온 state 의 last 를 그대로 돌려줘, 호출부가 「같으면 상태를 바꾸지 않는」 판정을 참조 비교로 할 수 있다.
 */
export function trackTarget(state: TargetTrack, { detail, syntaxError }: { detail: NodeDetail | null; syntaxError: boolean }): TargetTrack & {
  lock: InstructionLockReason | null
} {
  const lost = state.lost || detail === null
  const lock = lockReason({ syntaxError, detail, lost, target: state.last })
  if (lock !== null || detail === null) return { last: state.last, lost, lock }
  const now = targetOf(state.last.nodeKey, detail)
  return { last: sameTarget(now, state.last) ? state.last : now, lost: false, lock }
}
