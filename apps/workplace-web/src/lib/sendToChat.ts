// 「채팅·이슈로 보내기」(WP-1235) — 지금 보는 대상의 앱 링크를 앱 안 채널·DM·이슈 댓글로 보낸다. React 밖 순수 TS 라 vitest(node)로 검증한다.
// 받는 쪽은 본문의 앱 링크를 기존 앱 링크 카드(AppLinkCard)로 그리므로, 여기서는 「어디로·무슨 본문으로」만 정한다.
// 대화상자를 여는 곳(🔗 토스트 단추·⋯·⬆︎ 시트)이 React 밖(토스트 콜백)에도 있어, 열림 상태는 작은 모듈 스토어로 둔다 — AppLayout 의 호스트가 구독한다.
import type { ShareTarget } from './shareTarget'
import { type StorageOwner, userScopedKey } from './userScopedKey'

/** 보낼 곳 — 채널, 사람(DM 은 보낼 때 찾거나 만든다), 이슈(댓글). */
export type SendDestination =
  | { kind: 'channel'; channelId: number; name: string }
  | { kind: 'person'; userId: number; name: string }
  | { kind: 'issue'; issueId: number; projectKey: string; number: number; title: string }

/** 보낼 곳의 고유 값 — 목록 key·최근 대상 중복 거르기에 쓴다. */
export function destinationKey(d: SendDestination): string {
  if (d.kind === 'channel') return `channel:${d.channelId}`
  if (d.kind === 'person') return `person:${d.userId}`
  return `issue:${d.issueId}`
}

/** 보낼 곳의 화면 이름 — 채널은 #이름, 사람은 이름, 이슈는 키와 제목. */
export function destinationLabel(d: SendDestination): string {
  if (d.kind === 'channel') return `#${d.name}`
  if (d.kind === 'person') return d.name
  return `${d.projectKey}-${d.number} ${d.title}`
}

/**
 * 보낼 본문 — 함께 보낼 말이 있으면 그 말 다음 줄에 링크를 둔다. 링크만 있어도 받는 쪽은 카드로 본다.
 * 말은 앞뒤 공백만 걷고 안쪽 줄바꿈은 그대로 둔다(사용자가 쓴 모양 그대로).
 */
export function buildSendBody(url: string, note: string): string {
  const text = note.trim()
  return text ? `${text}\n${url}` : url
}

/** 이슈 키처럼 생긴 검색어(WP-12)를 읽는다 — 프로젝트 횡단 검색(/me/issues?q=)은 제목·본문만 찾으므로 키는 따로 연다. */
export function parseIssueKeyQuery(q: string): { projectKey: string; number: number } | null {
  const m = /^([A-Za-z][A-Za-z0-9]{1,9})-([1-9][0-9]{0,8})$/.exec(q.trim())
  return m ? { projectKey: m[1].toUpperCase(), number: Number(m[2]) } : null
}

// ── 최근 대상 ────────────────────────────────────────────────
// 서버에 「최근 보낸 곳」 개념이 없어 이 기기에만 둔다. 같은 브라우저의 다른 사용자·워크스페이스와 섞이지 않게 주인별 키(userScopedKey)를 쓴다.

const RECENT_BASE = 'send-to-chat.recent'
/** 최근 대상 최대 수 — 대화상자 첫 화면이 길어지지 않게. */
export const MAX_RECENT_DESTINATIONS = 5

/** 저장된 값이 보낼 곳 모양인가 — 손상·옛 모양은 버린다(읽지 못한 값으로 보내지 않게). */
function isDestination(v: unknown): v is SendDestination {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  const id = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x > 0
  if (o.kind === 'channel') return id(o.channelId) && typeof o.name === 'string'
  if (o.kind === 'person') return id(o.userId) && typeof o.name === 'string'
  if (o.kind === 'issue') {
    return id(o.issueId) && typeof o.projectKey === 'string' && id(o.number) && typeof o.title === 'string'
  }
  return false
}

/** 최근 보낸 곳(새것부터). 없거나 손상됐거나 저장소를 못 쓰면(사파리 프라이빗 등) 빈 목록. */
export function readRecentDestinations(owner: StorageOwner): SendDestination[] {
  try {
    const raw = localStorage.getItem(userScopedKey(RECENT_BASE, owner))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isDestination).slice(0, MAX_RECENT_DESTINATIONS) : []
  } catch {
    return []
  }
}

/** 최근 대상에서 d 를 뺀 목록. */
function recentWithout(owner: StorageOwner, d: SendDestination): SendDestination[] {
  const key = destinationKey(d)
  return readRecentDestinations(owner).filter((x) => destinationKey(x) !== key)
}

/** 최근 대상을 저장한다. 저장 실패(저장소를 못 씀)는 다음에 최근 목록이 비어 보일 뿐이라 무시한다. */
function writeRecent(owner: StorageOwner, list: SendDestination[]): void {
  try {
    localStorage.setItem(userScopedKey(RECENT_BASE, owner), JSON.stringify(list))
  } catch {
    // 저장소를 못 쓰면 최근 대상이 없을 뿐이다.
  }
}

/** 보낸 곳을 최근 대상 맨 앞에 둔다(같은 곳은 하나만). */
export function rememberDestination(owner: StorageOwner, d: SendDestination): void {
  writeRecent(owner, [d, ...recentWithout(owner, d)].slice(0, MAX_RECENT_DESTINATIONS))
}

/** 최근 대상에서 뺀다 — 보내기가 권한 없음·없음·잘못된 요청(403·404·400)으로 실패한 곳(나간 채널·지운 이슈 등)을 다시 권하지 않게. */
export function forgetDestination(owner: StorageOwner, d: SendDestination): void {
  writeRecent(owner, recentWithout(owner, d))
}

/**
 * 최근 대상을 지금 내 채널 목록에 맞춘다 — 나갔거나 보관된 채널은 빼고, 이름이 바뀌었으면 지금 이름으로 보인다.
 * 채널 목록을 아직 받지 못했으면(undefined) 채널은 잠시 뺀다 — 못 쓰는 채널을 권했다가 사라지거나 Enter 로 골라지지 않게.
 * 사람·이슈는 그대로 둔다(보낼 때 실패하면 forgetDestination 으로 빠진다).
 */
export function validRecentDestinations(
  recent: SendDestination[],
  channels: readonly { id: number; name: string; archived?: boolean }[] | undefined,
): SendDestination[] {
  const live = new Map((channels ?? []).filter((c) => !c.archived).map((c) => [c.id, c.name]))
  return recent.flatMap((d): SendDestination[] => {
    if (d.kind !== 'channel') return [d]
    const name = live.get(d.channelId)
    return name === undefined ? [] : [{ ...d, name }]
  })
}

// ── 열림 상태 스토어 ─────────────────────────────────────────
// 열 때마다 새 세션 id 를 준다 — 보내기가 끝나 닫을 때, 그 사이 다른 대상으로 다시 연 대화상자(새 세션)를 닫지 않게 한다.

/** 열린 대화상자 하나 — 대상과 세션 id. 열 때마다 새 객체라 useSyncExternalStore 스냅샷이 안정적이다. */
export interface SendToChatSession {
  target: ShareTarget
  id: number
}

let current: SendToChatSession | null = null
let nextSessionId = 1
let pendingOpen: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

/**
 * 대화상자를 연다 — 이 대상의 링크를 보낸다. 🔗 토스트 단추·⋯·⬆︎ 시트가 부른다.
 * 다음 틱에 연다 — 메뉴·시트에서 부르면 같은 틱에 닫히는 메뉴가 트리거로 돌려주는 초점·오버레이 정리와 대화상자 초점이 부딪친다.
 * 호출부마다 미루지 않게 여기 한 곳에서 한다. 미룬 사이 다시 부르면 마지막 것만 연다.
 */
export function openSendToChat(target: ShareTarget): void {
  if (pendingOpen !== null) clearTimeout(pendingOpen)
  pendingOpen = setTimeout(() => {
    pendingOpen = null
    current = { target, id: nextSessionId++ }
    listeners.forEach((l) => l())
  }, 0)
}

/**
 * 대화상자를 닫는다. sessionId 를 주면 그 세션이 아직 열려 있을 때만 닫는다(늦게 끝난 보내기가 새로 연 창을 닫지 않게).
 * 인자 없이 부르면 무조건 닫고, 아직 열리지 않은(미룬) 열기도 취소한다.
 */
export function closeSendToChat(sessionId?: number): void {
  if (sessionId === undefined && pendingOpen !== null) {
    clearTimeout(pendingOpen)
    pendingOpen = null
  }
  if (current === null) return
  if (sessionId !== undefined && current.id !== sessionId) return
  current = null
  listeners.forEach((l) => l())
}

/** 지금 열린 세션(닫혔으면 null) — 호스트의 useSyncExternalStore 스냅샷. */
export function sendToChatSession(): SendToChatSession | null {
  return current
}

/** 지금 열린 대상(닫혔으면 null). */
export function sendToChatTarget(): ShareTarget | null {
  return current?.target ?? null
}

/** 열림 상태를 구독한다(useSyncExternalStore 용). */
export function subscribeSendToChat(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
