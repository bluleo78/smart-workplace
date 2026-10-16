// AI 작업 중 유령 버블 상태 훅 — 진행 이벤트 구독 + 새 AGENT 메시지 백스톱 + TTL 스위프.
// 상태 전이 규칙은 @/lib/aiWorkingProgress 의 순수 함수(단위 테스트 대상), 여기는 React 배선만 둔다(WP-412).
// 채널(A9)·DM(#345)·이슈 채팅이 같은 훅을 쓴다(WP-418) — 이벤트 출처만 subscribe 인자로 갈아 끼운다.
//
// 대화방 전환 리셋의 주 경로는 호출 측 리마운트다(App.tsx 의 채널/DM 라우트 key, IssueChatSection 의 이슈별 key).
// 아래 key 꼬리표는 그 약속이 깨져 리마운트 없이 key 가 바뀌어도 이전 대화방 버블이 새지 않게 하는 방어선일 뿐이다
// — 상태·ref 에 key 를 함께 저장하고, 읽거나 쓸 때 key 가 다르면 빈 값으로 본다(렌더 중 setState 나 effect 순서에 기대지 않는다).
import { useEffect, useRef, useState } from 'react'

import {
  applyProgressEvent,
  maxAgentMessageId,
  nextAgentBaseline,
  type ProgressEventLike,
  type ProgressSubscribe,
  sweepStaleWorking,
  type WorkingMap,
} from '@/lib/aiWorkingProgress'

/** 스위프 주기 — 10초. TTL(60초) 대비 충분히 촘촘하면서 타이머 비용은 낮다. */
const SWEEP_INTERVAL_MS = 10_000

/** 버블 맵과 그 맵이 속한 대화방 key — key 가 바뀐 뒤 이전 대화방 맵을 쓰지 않게 하는 꼬리표. */
interface KeyedWorking<E extends ProgressEventLike> {
  key: number | undefined
  map: WorkingMap<E>
}

/** 렌더와 무관한 대화방별 기록 — ended: 종료된(done/error) streamId(뒤늦은 비종료 이벤트의 버블 부활 차단),
 * baseline: 새 AGENT 메시지 판정 기준선(첫 로드 시점의 최대 AGENT id, null = 아직 안 잡음). */
interface RoomRecord {
  key: number | undefined
  ended: Set<string>
  baseline: number | null
}

/** 저장된 맵이 k 대화방 것이면 그대로, 아니면 빈 맵 — 읽기·갱신 모두 이 한 곳을 거친다. */
function mapFor<E extends ProgressEventLike>(s: KeyedWorking<E>, k: number | undefined): WorkingMap<E> {
  return s.key === k ? s.map : new Map()
}

/** k 대화방 맵을 f 로 갱신한 다음 상태 — 바뀐 게 없으면 같은 상태 참조를 돌려 불필요한 리렌더를 막는다. */
function nextWorking<E extends ProgressEventLike>(
  prev: KeyedWorking<E>,
  k: number | undefined,
  f: (m: WorkingMap<E>) => WorkingMap<E>,
): KeyedWorking<E> {
  const next = f(mapFor(prev, k))
  return next === prev.map ? prev : { key: k, map: next }
}

/** k 대화방의 기록 — 저장된 기록이 다른 대화방 것이면 여기 한 곳에서 새로 시작한다. */
function roomFor(ref: { current: RoomRecord }, k: number | undefined): RoomRecord {
  if (ref.current.key !== k) ref.current = { key: k, ended: new Set(), baseline: null }
  return ref.current
}

/**
 * 대화방의 진행 중 AI 스트림(streamId → 마지막 이벤트) 맵을 돌려준다.
 *
 * @param key 구독할 대화방 id(채널·DM id 또는 이슈 채팅 threadId). undefined 면 아직 모르므로 구독하지 않는다.
 *   바뀌면 호출 측이 리마운트하는 게 원칙이지만, 리마운트 없이 바뀌어도 이전 대화방 상태는 버려진다(위 머리말).
 * @param subscribe 진행 이벤트 구독 함수(안정 참조).
 * @param messages 현재 메시지 목록 — 새 AGENT 메시지 도착 판정용.
 * @param messagesLoaded 첫 메시지 조회 완료 여부 — 완료 전엔 기준선을 잡지 않는다(라이브 버블 보호).
 */
export function useAiWorkingBubbles<E extends ProgressEventLike>(
  key: number | undefined,
  subscribe: ProgressSubscribe<E>,
  messages: { id: number; authorKind?: string | null }[],
  messagesLoaded: boolean,
): WorkingMap<E> {
  const [working, setWorking] = useState<KeyedWorking<E>>(() => ({ key, map: new Map() }))
  const roomRef = useRef<RoomRecord>({ key, ended: new Set(), baseline: null })

  useEffect(() => {
    if (key == null) return
    return subscribe(key, (e) => {
      const { ended } = roomFor(roomRef, key)
      setWorking((prev) => nextWorking(prev, key, (m) => applyProgressEvent(m, ended, e, Date.now())))
    })
  }, [key, subscribe])

  // 신규 AGENT 메시지가 도착하면(실제 응답 등장) 모든 유령 버블 제거 — 판정은 nextAgentBaseline.
  // 새 대화방이면 roomFor 가 기준선을 null 로 되돌려 첫 로드로 다시 잡고 버블은 지우지 않는다.
  const maxAgentMsgId = maxAgentMessageId(messages)
  useEffect(() => {
    if (!messagesLoaded) return
    const room = roomFor(roomRef, key)
    const { baseline, clear } = nextAgentBaseline(room.baseline, maxAgentMsgId)
    room.baseline = baseline
    if (clear) setWorking((prev) => nextWorking(prev, key, () => new Map()))
  }, [key, messagesLoaded, maxAgentMsgId])

  // TTL 안전망: 60초 무수신 유령 제거 (10초마다 스위프). 저장된 대화방 그대로 스위프한다(다른 대화방 것이면 읽을 때 버려진다).
  useEffect(() => {
    const t = setInterval(
      () => setWorking((prev) => nextWorking(prev, prev.key, (m) => sweepStaleWorking(m, Date.now()))),
      SWEEP_INTERVAL_MS,
    )
    return () => clearInterval(t)
  }, [])

  // 다른 대화방 맵이면 빈 맵 — 리마운트 없이 key 가 바뀐 첫 렌더부터 이전 대화방 버블을 그리지 않는다.
  return mapFor(working, key)
}
