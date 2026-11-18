// WP-962 메일 보관·옮기기·삭제 대기열 — 실행 취소를 「요청을 미루기」로 구현한다.
// 누르면 목록에서 바로 숨기고 「보관했습니다 · 실행 취소」 토스트를 띄운다. 토스트가 닫히면(자동·스와이프) 그때 서버에 옮기기를 보내고,
// 「실행 취소」면 보내지 않고 다시 보인다(서버 휴지통에서 되살리는 API 없이도 삭제까지 되돌릴 수 있다 — runWithUndoToast 와 같은 규칙).
//  - 숨김 집합은 모듈 상태라 다른 보기·화면으로 옮겨도 유지된다 — 60초 주기 재조회·포커스 재조회·SSE 무효화가 옮기기 전 목록을 다시
//    받아도 숨긴 행이 되살아나지 않는다. 옮긴 뒤 목록을 다시 받은 다음에 숨김을 푼다(그 사이 행이 깜빡 나타나지 않게).
//  - 보내기는 컴포넌트 밖(모듈)에서 한다 — 토스트가 닫힐 때 메일 화면을 이미 떠났어도 보내고 캐시를 갱신한다.
//  - 탭을 닫거나 새로고침하면(pagehide), 또는 화면이 숨으면(visibilitychange hidden — 모바일은 앱 전환 뒤 종료되면 pagehide 가 오지 않을 수 있다)
//    아직 토스트에 걸린 옮기기를 keepalive 요청으로 바로 보낸다 — 사용자가 취소하지 않았으니 실행이다. keepalive 응답은 받지 못하므로, 화면이
//    다시 보이면 목록을 다시 받고 그때 숨김을 푼다(서버가 옮겼으면 목록에 없고, 실패했으면 다시 보인다).
import type { QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { moveMessages, moveMessagesOnUnload } from '@/api/mailMessages'
import { mailMessageKeys } from '@/hooks/queries/mailMessageKeys'
import type { MailMoveRequest } from '@/types/mailFolder'

import { handleApiError } from './api-error'
import { runWithUndoToast, type UndoToastHandle } from './deleteWithUndo'
import type { MailRowFolderPatch } from './mailMoveActions'

// ===== 숨김 집합(외부 저장소 — useSyncExternalStore) =====

let hidden: ReadonlySet<number> = new Set()
const listeners = new Set<() => void>()

function setHidden(next: ReadonlySet<number>) {
  hidden = next
  listeners.forEach((l) => l())
}
function hide(ids: readonly number[]) {
  setHidden(new Set([...hidden, ...ids]))
}
function unhide(ids: readonly number[]) {
  if (ids.length === 0) return
  const next = new Set(hidden)
  ids.forEach((id) => next.delete(id))
  setHidden(next)
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
// ===== 대기 중 목적지 메일함(WP-1742 — 숨기지 않는 옮기기) =====
// 별표 보기의 보관·옮기기는 행을 숨기지 않는다. 대기(토스트)·요청·목록 재조회가 끝날 때까지 행을 목적지 메일함에 있는 것처럼 보이게 할 값을
// 메일 id 별로 둔다 — 숨김 집합처럼 모듈 상태라 그 사이 주기 재조회·SSE 무효화가 옛 메일함 값으로 목록을 다시 받아도 덮이지 않는다
// (React Query 캐시를 직접 고치면 그 재조회가 덮어 「보관」이 도로 보인다).
// 같은 메일을 대기 중에 또 옮기면 쌓아 두고 마지막 것을 보인다 — 나중 것을 실행 취소하면 앞 목적지로 돌아간다.

let patchStacks = new Map<number, { entry: object; patch: MailRowFolderPatch }[]>()
let patches: ReadonlyMap<number, MailRowFolderPatch> = new Map()

/** 쌓인 값에서 메일별 마지막 목적지를 다시 만들고 구독자에게 알린다. */
function publishPatches() {
  patches = new Map([...patchStacks].map(([id, stack]) => [id, stack[stack.length - 1].patch]))
  listeners.forEach((l) => l())
}
function addPatch(entry: object, ids: readonly number[], patch: MailRowFolderPatch) {
  const next = new Map(patchStacks)
  ids.forEach((id) => next.set(id, [...(next.get(id) ?? []), { entry, patch }]))
  patchStacks = next
  publishPatches()
}
/** 이 옮기기(entry)가 얹은 값만 뗀다 — 같은 메일의 다른 대기 중 옮기기 값은 남긴다. */
function dropPatch(entry: object, ids: readonly number[]) {
  if (!ids.some((id) => patchStacks.get(id)?.some((p) => p.entry === entry))) return
  const next = new Map(patchStacks)
  for (const id of ids) {
    const rest = (next.get(id) ?? []).filter((p) => p.entry !== entry)
    if (rest.length > 0) next.set(id, rest)
    else next.delete(id)
  }
  patchStacks = next
  publishPatches()
}
/** 지금 얹은 목적지 메일함 값(렌더 밖에서 읽을 때·테스트). */
export const mailMovePatchSnapshot = () => patches

/** WP-1742 대기 중인(숨기지 않는) 옮기기의 목적지 메일함 값 — 메일 id → 행에 덮어쓸 folderId·folderRole·folderName. */
export function useMailMovePatches(): ReadonlyMap<number, MailRowFolderPatch> {
  return useSyncExternalStore(subscribe, mailMovePatchSnapshot, mailMovePatchSnapshot)
}

/** 지금 숨긴 id 집합(렌더 밖에서 읽을 때·테스트). */
export const mailMoveHiddenSnapshot = () => hidden

/** 옮기는 중(토스트 대기·요청 중)이라 목록에서 숨길 메일 id. */
export function useMailMoveHidden(): ReadonlySet<number> {
  return useSyncExternalStore(subscribe, mailMoveHiddenSnapshot, mailMoveHiddenSnapshot)
}

// ===== 대기열 =====

interface PendingMove {
  qc: QueryClient
  accountId: number
  body: MailMoveRequest
  handle?: UndoToastHandle
  /** WP-1742 옮긴 메일(성공 id)을 목록 재조회 뒤 호출 측에 알린다 — 얹은 목적지 값을 떼기 직전(scheduleMailMove 의 onMoved). */
  onMoved?: (okIds: number[]) => void
}

/** 토스트가 아직 떠 있어 보내지 않은 옮기기. */
const pending = new Set<PendingMove>()
/**
 * WP-1682 서버에 보내 응답을 기다리는 옮기기(토스트가 이미 닫혔다) — 계정별. 휴지통 비우기가 되살리기 응답을 기다린 뒤 시작하도록 flushMailMoves 가 함께 기다린다.
 * 끝나면(성공·실패 모두) 빠진다.
 */
const inFlight = new Map<Promise<void>, number>()
/** keepalive 로 보내 결과를 모르는 옮기기 — 화면이 다시 보이면 목록을 다시 받고 숨김을 푼다. */
let flushed: PendingMove[] = []
let listenersBound = false

/** 페이지가 내려가거나 숨을 때 대기 중인 옮기기를 keepalive 로 보낸다(토스트 결론은 「보냄」으로 닫는다). */
function flushPending() {
  for (const p of pending) {
    p.handle?.settleNow(false)
    moveMessagesOnUnload(p.accountId, p.body)
    flushed.push(p)
  }
  pending.clear()
}

/** 화면 숨김 → 보내기, 다시 보임 → keepalive 로 보낸 것의 목록 갱신·숨김 해제. */
function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    flushPending()
    return
  }
  const done = flushed
  flushed = []
  for (const p of done) void refreshThenUnhide(p.qc, p.accountId, p.body.messageIds, p)
}

/**
 * 옮기기 예약 — 바로 숨기고 실행 취소 토스트를 띄운다. 토스트가 닫히면 서버에 보낸다.
 * @param message 토스트 문구(mailMoveToastMessage)
 * @param onUndo 실행 취소했을 때(호출 측 상태 되돌리기 — 없어도 숨김은 풀린다)
 * @param hideRows false 면 목록에서 숨기지 않는다(WP-1742 별표 보기의 보관·옮기기 — 별표는 그대로라 옮긴 뒤에도 목록에 남는다). 옮긴 뒤 목록을
 *   다시 받는 것(refreshThenUnhide)은 그대로라 메일함 배지가 바뀐다. 숨기지 않은 id 를 푸는 것은 아무 일도 하지 않는다. 기본 true.
 * @param rowPatch 숨기지 않는 옮기기에서 대기 중 행에 얹을 목적지 메일함 값(WP-1742, mailMoveRowPatch) — 실행 취소·실패면 바로,
 *   옮긴 뒤엔 목록을 다시 받은 다음에 뗀다(그때는 서버 목록이 같은 값을 준다).
 * @param onMoved 옮긴 뒤 목록을 다시 받고 목적지 값을 떼기 직전에 성공한 id 로 부른다(WP-1742) — 서버 목록에 없고 스냅샷(유지 집합·열린 행)으로만
 *   보이는 행은 재조회가 고쳐 주지 않으므로 호출 측이 스냅샷에 목적지를 옮겨 적는다(같은 틱이라 옛 메일함으로 깜빡이지 않는다).
 */
export function scheduleMailMove(args: {
  qc: QueryClient
  accountId: number
  messageIds: number[]
  target: MailMoveRequest['target']
  message: string
  onUndo?: () => void
  hideRows?: boolean
  rowPatch?: MailRowFolderPatch | null
  onMoved?: (okIds: number[]) => void
}): void {
  const { qc, accountId, messageIds, target, message, hideRows = true } = args
  if (messageIds.length === 0) return
  if (hideRows) hide(messageIds)
  if (!listenersBound && typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPending)
    document.addEventListener('visibilitychange', onVisibilityChange)
    listenersBound = true
  }
  const entry: PendingMove = { qc, accountId, body: { messageIds, target }, onMoved: args.onMoved }
  if (args.rowPatch) addPatch(entry, messageIds, args.rowPatch)
  pending.add(entry)
  entry.handle = runWithUndoToast(
    message,
    () => {
      pending.delete(entry)
      void startCommit(qc, entry)
    },
    {
      onUndo: () => {
        pending.delete(entry)
        unhide(messageIds)
        dropPatch(entry, messageIds)
        args.onUndo?.()
      },
    },
  )
}

/**
 * WP-1682 그 계정의 토스트 대기 중 옮기기를 지금 보내고(토스트는 settleNow(false)로 닫는다 — execute·onUndo 를 다시 부르지 않는다)
 * 서버 반영·목록 갱신까지 끝나길 기다린다. 토스트가 이미 닫혀 응답을 기다리는 중인 옮기기(inFlight)도 함께 기다린다.
 * 휴지통 비우기를 시작하기 전에 부른다 — 방금 되살린 메일이 아직 서버 휴지통에 남아 같이 지워지지 않게.
 * 되살리기가 실패해도 기다림은 끝난다(오류 토스트가 떴고 메일은 휴지통에 다시 보인다 — 비우기를 막을 까닭이 아니다).
 * 다른 계정의 옮기기는 건드리지도 기다리지도 않는다. 대기·진행이 없으면 곧바로 끝난다.
 */
export function flushMailMoves(accountId: number): Promise<void> {
  for (const p of [...pending]) {
    if (p.accountId !== accountId) continue
    pending.delete(p)
    p.handle?.settleNow(false)
    void startCommit(p.qc, p)
  }
  // 거부돼도(있어선 안 되지만) 기다림만 끝낸다 — 옮기기 실패는 commitMove 가 이미 알렸다.
  const mine = [...inFlight].filter(([, id]) => id === accountId).map(([promise]) => promise.catch(() => undefined))
  return Promise.all(mine).then(() => undefined)
}

/** 옮기기를 서버에 보내고 끝날 때까지 inFlight 에 둔다(flushMailMoves 가 기다릴 수 있게). commitMove 는 실패해도 거부하지 않는다. */
function startCommit(qc: QueryClient, entry: PendingMove): Promise<void> {
  const promise = commitMove(qc, entry).finally(() => {
    inFlight.delete(promise)
  })
  inFlight.set(promise, entry.accountId)
  return promise
}

/**
 * 서버에 옮기기를 보내고 결과를 반영한다. 실패한 메일은 숨김을 풀어 목록에 되돌리고 오류를 알린다.
 * 옮긴 메일은 목록·안 읽은 수·메일함 목록을 다시 받은 뒤에 숨김을 푼다.
 */
async function commitMove(qc: QueryClient, entry: PendingMove): Promise<void> {
  const { accountId, body } = entry
  const ids = body.messageIds
  let okIds: number[]
  try {
    const res = await moveMessages(accountId, body)
    const failed = res.results.filter((r) => !r.ok)
    okIds = res.results.filter((r) => r.ok).map((r) => r.messageId)
    // 결과에 빠진 메일(있어선 안 되지만)도 되돌린다 — 영원히 숨지 않게.
    const failedIds = ids.filter((id) => !okIds.includes(id))
    unhide(failedIds)
    dropPatch(entry, failedIds)
    if (failed.length > 0 || failedIds.length > 0) {
      const reason = failed[0]?.error ?? '메일 서버에서 옮기지 못했습니다'
      toast.error(failedIds.length > 1 ? `메일 ${failedIds.length}통을 옮기지 못했어요 — ${reason}` : `메일을 옮기지 못했어요 — ${reason}`)
    }
  } catch (e) {
    unhide(ids)
    dropPatch(entry, ids)
    handleApiError(e, '메일을 옮기지 못했어요')
    return
  }
  await refreshThenUnhide(qc, accountId, okIds, entry)
}

/** 목록·안 읽은 수·메일함 목록·상세를 다시 받은 뒤 숨김을 푼다(그 사이 행이 깜빡 나타나지 않게). 얹은 목적지 값(WP-1742)도 그때 뗀다. */
async function refreshThenUnhide(qc: QueryClient, accountId: number, okIds: number[], entry: PendingMove): Promise<void> {
  await Promise.allSettled([
    qc.invalidateQueries({ queryKey: ['mail-messages', accountId] }),
    // 안 읽은 수 키 아래에 메일함 목록(보관·내 메일함 안 읽은 수)도 있다(mailMessageKeys.folders).
    qc.invalidateQueries({ queryKey: mailMessageKeys.unreadCountsAll() }),
    qc.invalidateQueries({ queryKey: mailMessageKeys.unreadSummary() }),
    qc.invalidateQueries({ queryKey: ['mail-summary'], exact: true }),
    ...okIds.map((id) => qc.invalidateQueries({ queryKey: mailMessageKeys.detail(id) })),
  ])
  unhide(okIds)
  if (okIds.length > 0) entry.onMoved?.(okIds)
  dropPatch(entry, okIds)
}

/** 테스트 전용 — 모듈 상태 초기화. */
export function resetMailMoveQueueForTest() {
  pending.clear()
  inFlight.clear()
  flushed = []
  patchStacks = new Map()
  patches = new Map()
  setHidden(new Set())
}
