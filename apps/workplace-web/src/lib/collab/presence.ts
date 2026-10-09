import {
  COLLAB_AI_MARKERS_FIELD,
  COLLAB_CURSOR_FIELD,
  COLLAB_USER_FIELD,
  parseAiMarkers,
  parseCollabCursor,
  parseCollabUser,
} from '@smart-workplace/wiki-editor-schema/collab-protocol'
import type { CSSProperties } from 'react'

/**
 * 노트 접속자(WP-173) 순수 로직 — awareness 상태에서 "이 노트를 보고 있는 다른 사람" 목록과 사람 색을 정한다.
 * 화면(헤더 아바타·목록)과 원격 커서가 같은 규칙을 쓰도록 한곳에 둔다. DOM·React 상태 없이 vitest 로 검증한다.
 */

/** 사람 색 개수 — index.css 의 --presence-1..8 토큰과 짝(presenceTokens.test 가 대비를 검증). */
export const PRESENCE_COLOR_COUNT = 8

/** userId → 1..8. 같은 사람은 어디서나 같은 색이고, 연속 id(작은 팀)는 서로 다른 색이 된다. */
export function presenceColorIndex(userId: number): number {
  const n = Math.trunc(userId)
  return (((n % PRESENCE_COLOR_COUNT) + PRESENCE_COLOR_COUNT) % PRESENCE_COLOR_COUNT) + 1
}

/** 사람 색 토큰 변수 — 위젯 DOM(React 밖)이 style 로 쓴다. */
export function presenceColorVar(userId: number): string {
  return `var(--presence-${presenceColorIndex(userId)})`
}

/** React 요소용 — `--presence-color` 를 그 사람 색으로 둔다(동적 Tailwind 클래스 생성 금지라 변수로 넘긴다). */
export function presenceStyle(userId: number): CSSProperties {
  return { '--presence-color': presenceColorVar(userId) } as CSSProperties
}

/** awareness.getStates() 의 모양 — 값은 자기 신고라 무엇이든 올 수 있다. */
export type AwarenessStates = Map<number, Record<string, unknown> | null | undefined>

/** 접속자 한 사람(같은 사람의 여러 탭은 하나로). */
export interface PresencePerson {
  userId: number
  name: string
  /** 이 사람의 AI 가 지금 쓰는 중(✦) — /ai 생성 또는 서버 적용 표식. */
  aiWriting: boolean
  /** 편집 포커스가 있어 커서를 올렸다(목록에서 "보는 중" 을 붙이지 않고 커서로 이동할 수 있다). */
  editing: boolean
  /** 이 사람의 접속(탭) clientID 들 — 커서로 이동·이름표 보이기에 쓴다. 서버 표식만 있는 사람은 비어 있다. */
  clientIds: number[]
}

/**
 * 내 userId — 로그인 사용자 id(화면이 넘긴 값)가 우선, 없으면 내 awareness 상태의 user(announcePresence).
 * 로컬 user 만 보면 announce 전·정리 뒤(null)에 내 다른 탭이 잠깐 섞인다. 헤더(derivePeople)와 원격 커서가 같은 기준을 쓴다.
 */
export function resolveSelfUserId(
  userId: number | null,
  localState: Record<string, unknown> | null | undefined,
): number | null {
  return userId ?? parseCollabUser(localState?.[COLLAB_USER_FIELD])?.id ?? null
}

/** 이름이 빈 표식(서버가 이름을 모를 때)의 표시 이름. */
const UNKNOWN_NAME = '이름 없는 사용자'

/**
 * awareness → 다른 접속자 목록.
 * - 나는 뺀다: 내 clientID 와, 같은 userId 의 내 다른 탭(스펙: 헤더 = "지금 이 노트를 연 다른 사람").
 * - 같은 사람의 여러 탭은 하나로 합친다.
 * - AI 작성 중은 aiMarkers 로만 판단한다 — 서버 상태(user 없음)의 표식도 그 표식의 userId 사람에게 붙인다.
 *   그래서 노트를 열지 않은 사람도 그 사람의 AI 가 쓰는 3초 동안은 목록에 "AI 작성 중" 으로 보인다.
 * - 순서: AI 작성 중인 사람 먼저, 나머지는 들어온 순서(Map 순회 순서, 안정 정렬).
 */
export function derivePeople(states: AwarenessStates, self: { clientId: number; userId: number | null }): PresencePerson[] {
  const selfUserId = resolveSelfUserId(self.userId, states.get(self.clientId))
  const byUser = new Map<number, PresencePerson>()
  // 이름을 본인 user 필드에서 받은 사람 — 서버 표식 이름(서버가 아는 이름·빈 값)보다 본인 신고 이름을 우선한다(들어온 순서와 무관).
  const namedByUser = new Set<number>()
  const personOf = (userId: number, name: string, fromUser: boolean): PresencePerson => {
    let p = byUser.get(userId)
    if (!p) {
      p = { userId, name, aiWriting: false, editing: false, clientIds: [] }
      byUser.set(userId, p)
    } else if (fromUser ? !namedByUser.has(userId) : !p.name && name) {
      p.name = name
    }
    if (fromUser) namedByUser.add(userId)
    return p
  }
  for (const [clientId, state] of states) {
    if (clientId === self.clientId || !state) continue
    const user = parseCollabUser(state[COLLAB_USER_FIELD])
    if (user && user.id !== selfUserId) {
      const p = personOf(user.id, user.name, true)
      p.clientIds.push(clientId)
      if (parseCollabCursor(state[COLLAB_CURSOR_FIELD])) p.editing = true
    }
    for (const m of parseAiMarkers(state[COLLAB_AI_MARKERS_FIELD])) {
      if (m.userId === selfUserId) continue
      personOf(m.userId, m.name, false).aiWriting = true
    }
  }
  const people = [...byUser.values()].map((p) => ({ ...p, name: p.name || UNKNOWN_NAME }))
  return people.sort((a, b) => Number(b.aiWriting) - Number(a.aiWriting))
}

/** 목록 비교 키 — 커서가 움직이기만 하면 같다(헤더가 커서 이동마다 다시 그리지 않게). */
export function peopleSignature(people: PresencePerson[]): string {
  return people
    .map((p) => `${p.userId}|${p.name}|${p.aiWriting ? 1 : 0}|${p.editing ? 1 : 0}|${p.clientIds.join(',')}`)
    .join('\n')
}

/** 앞에서 max 개만 보이고 나머지 수(+N). */
export function splitVisible<T>(items: T[], max: number): { shown: T[]; more: number } {
  return items.length <= max ? { shown: items, more: 0 } : { shown: items.slice(0, max), more: items.length - max }
}

/** 목록에서 이 사람을 눌렀을 때 갈 위치(상대 위치 JSON) — 커서 head 우선, 없으면 그 사람 AI 표식 위치. 둘 다 없으면 null. */
export function jumpAnchor(states: AwarenessStates, person: PresencePerson): object | null {
  for (const id of person.clientIds) {
    const c = parseCollabCursor(states.get(id)?.[COLLAB_CURSOR_FIELD])
    if (c) return c.head
  }
  for (const state of states.values()) {
    if (!state) continue
    const m = parseAiMarkers(state[COLLAB_AI_MARKERS_FIELD]).find((x) => x.userId === person.userId)
    if (m && typeof m.anchor === 'object' && m.anchor != null) return m.anchor
  }
  return null
}
