// DM 읽음 표시(WP-1176) — 읽은 사람 얼굴을 어느 메시지 아래에 붙일지, 실시간 읽음 이벤트로 목록을 어떻게 고칠지, 읽은 시각 문구.
// 화면(ReadReceipts·MessageList)과 실시간 처리(useMessageStream)가 같은 규칙을 쓰도록 순수 함수로 둔다.
import type { ChannelReadState, MessageResponse } from '../types/messaging'
import { formatListTime, kstDayRelative, kstParts, parseUtcDate } from './formatters'

/**
 * 메시지 id → 그 아래에 얼굴을 붙일 사람들. 각 사람은 「그 사람이 읽은 내 메시지 중 가장 뒤의 것」 한 곳에만 붙는다 —
 * 사람마다 표시가 하나라 대화가 길어져도 어수선하지 않다. 내 메시지가 아닌 것·지운 메시지·아직 보내는 중(음수 id)은 자리로 쓰지 않는다.
 * 읽은 위치보다 앞에 내 메시지가 하나도 없으면(그 사람이 읽은 내 메시지가 없으면) 붙이지 않는다.
 */
export function readersByMessage(
  messages: readonly MessageResponse[],
  readStates: readonly ChannelReadState[],
  currentUserId: number,
): Map<number, ChannelReadState[]> {
  // 내 메시지 id 오름차순(목록은 페이지 순서라 따로 정렬) — 읽은 위치 이하에서 가장 뒤의 것을 찾는다.
  const mine = messages
    .filter((m) => m.authorId === currentUserId && m.id > 0 && !m.deleted)
    .map((m) => m.id)
    .sort((a, b) => a - b)
  const out = new Map<number, ChannelReadState[]>()
  for (const r of readStates) {
    if (r.userId === currentUserId) continue
    let at: number | undefined
    for (const id of mine) {
      if (id > r.lastReadMessageId) break
      at = id
    }
    if (at === undefined) continue
    const list = out.get(at)
    if (list) list.push(r)
    else out.set(at, [r])
  }
  return out
}

/**
 * 실시간 읽음 이벤트 반영 — 그 사람의 읽은 위치가 앞으로 갈 때만 고친 새 배열을 준다(뒤로 가는 이벤트·같은 위치는 받은 배열 그대로).
 * 이벤트에 시각이 없으면(구 서버) 시각도 비운다 — 새 위치에 앞서 읽은 시각을 붙이면 틀린 시각이 보인다(「읽음」만 보인다).
 * 목록에 없는 사람이면 null — 이름을 모르니 호출 측이 목록을 다시 받는다.
 */
export function applyReadEvent(
  states: ChannelReadState[],
  e: { userId: number; lastReadMessageId: number; readAt: string | null },
): ChannelReadState[] | null {
  const i = states.findIndex((s) => s.userId === e.userId)
  if (i < 0) return null
  if (e.lastReadMessageId <= states[i].lastReadMessageId) return states
  const next = [...states]
  next[i] = { ...states[i], lastReadMessageId: e.lastReadMessageId, readAt: e.readAt }
  return next
}

/**
 * 읽은 시각 문구 — 「오후 12:47에 읽음」(오늘), 「어제 읽음」, 「10월 28일에 읽음」(올해), 「2025. 10. 28.에 읽음」.
 * 시각을 모르면(이 기능 전에 읽음) 「읽음」.
 */
export function readAtLabel(readAt: string | null, now: Date = new Date()): string {
  if (!readAt) return '읽음'
  const d = parseUtcDate(readAt)
  if (Number.isNaN(d.getTime())) return '읽음'
  if (kstDayRelative(kstParts(d), now) === 'yesterday') return '어제 읽음'
  return `${formatListTime(readAt, now)}에 읽음`
}
