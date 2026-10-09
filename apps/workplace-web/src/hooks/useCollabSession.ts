import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { type CollabResume } from '@/lib/collab/collabResume'
import {
  type CollabSession,
  openCollabSession,
  releaseCollabSession,
  retainCollabSession,
  setCollabSelfUser,
} from '@/lib/collab/collabSession'
import {
  type BodyState,
  deriveBodyState,
  deriveSyncStatus,
  effectiveReadOnly,
  OFFLINE_AFTER_MS,
  type SyncStatus,
} from '@/lib/collab/collabStatus'

/**
 * 노트 동시 편집 세션 훅 — 페이지의 동기화 세션을 잡고, 헤더 상태 칩과 실제 편집 가능 여부를 돌려준다.
 *
 * - 세션은 캐시(collabSession)에서 얻어 렌더 중에도 바로 쓸 수 있고(에디터 생성 시 doc 필요), 마운트 동안 보유한다.
 *   언마운트하면 유예 후 정리되며, 못 보낸 입력이 있으면 서버가 받을 때까지 남는다.
 * - readOnly: 화면이 아는 역할로 정한 값(canEdit 의 반대). 서버가 다른 값을 알려 오면(역할 변경) 그쪽을 따른다.
 * - 탭 닫기 경고(미전송 시)는 캐시가 건다 — 이 훅이 사라진 뒤에도 붙잡힌 세션이 있을 수 있어서다.
 */
export function useCollabSession(
  pageId: number,
  opts: { readOnly: boolean; userId?: number | null },
): {
  session: CollabSession
  status: SyncStatus
  readOnly: boolean
  body: BodyState
  stale: boolean
  /** 돌아와 동기화를 마친 마지막 결과(자리 비운 시간·그사이 고친 사람 수) — 토스트·하이라이트용(WP-293). */
  resume: CollabResume | null
} {
  // 렌더 중 세션 확보(보유 등록 없음) — 등록·해제는 effect 가 해서 StrictMode 이중 실행에도 수가 맞는다.
  // renewal: 쥐려던 세션이 이미 정리돼 있었을 때 다시 여는 트리거(아래 effect).
  const [renewal, setRenewal] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- renewal 은 값이 아니라 다시 열기 트리거다
  const session = useMemo(() => openCollabSession(pageId), [pageId, renewal])

  useEffect(() => {
    // 렌더와 보유 사이에 세션이 정리됐으면(숨겨진 화면이 유예 뒤 다시 보일 때 등) 캐시가 살아 있는 세션을 대신 잡아 준다 —
    // 그 세션으로 다시 렌더해 죽은 provider 를 쥔 채 영영 동기화되지 않는 화면을 막는다. 놓을 땐 실제로 잡은 세션을 놓는다.
    const held = retainCollabSession(session)
    // 드문 복구 경로(정리된 세션을 잡으려 한 경우)에만 한 번 다시 렌더한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (held !== session) setRenewal((n) => n + 1)
    return () => releaseCollabSession(held)
  }, [session])

  // 로그인 사용자 — 돌아와 "N명이 수정" 을 셀 때 내 다른 탭을 빼는 기준(awareness 에 내 상태가 늦게 와도 맞게).
  const userId = opts.userId ?? null
  useEffect(() => setCollabSelfUser(session, userId), [session, userId])

  const state = useSyncExternalStore(session.subscribe, session.getState)

  // 끊긴 지 5초가 지난 끊김 — 그 시각(disconnectedSince)을 기록해 둔다. 같은 끊김이 이어지는 동안만 유효하다.
  // 렌더에서 현재 시각을 읽지 않도록(순수 렌더) 경계 시점에 한 번 깨우는 타이머로 판정한다.
  const [offlineSince, setOfflineSince] = useState<number | null>(null)
  const since = state.disconnectedSince
  useEffect(() => {
    if (since === null) return
    const timer = setTimeout(() => setOfflineSince(since), Math.max(0, since + OFFLINE_AFTER_MS - Date.now()))
    return () => clearTimeout(timer)
  }, [since])

  const readOnly = effectiveReadOnly({
    propReadOnly: opts.readOnly,
    serverReadOnly: state.serverReadOnly,
    terminal: state.terminal,
  })
  const status = deriveSyncStatus({
    connected: state.connected,
    disconnectedForMs: since !== null && offlineSince === since ? OFFLINE_AFTER_MS : 0,
    unsynced: state.unsynced,
    readOnly,
    terminal: state.terminal,
    everSynced: state.everSynced,
  })
  // 본문 자리 — 첫 동기화 전 빈 문서(입력 유도 placeholder)를 보이지 않고, 첫 연결이 안 되면 안내로 바꾼다.
  // 'ready' 면 본문을 보여도 된다. 종단(삭제·권한 없음·로그인 상실·스키마 판 불일치)은 본문 위 자기 안내를 쓴다.
  const body = deriveBodyState({ everSynced: state.everSynced, status })
  // 한 번 동기화된 뒤 끊겨 있는 동안 — 원격 커서·접속자 아바타를 흐리게(스펙 §7.1 ② "재연결 중 원격 커서 흐리게").
  // 칩 상태가 아니라 연결 사실로 본다: VIEWER 는 칩이 'readonly' 라 재연결 중이 칩에 드러나지 않는다.
  // 흐리게 보일 대상(끊기기 직전 접속자)은 presenceAwarenessOf 덮개가 붙잡아 둔다(판정 11).
  const stale = state.everSynced && !state.connected && state.terminal === null
  return { session, status, readOnly, body, stale, resume: state.resume }
}
