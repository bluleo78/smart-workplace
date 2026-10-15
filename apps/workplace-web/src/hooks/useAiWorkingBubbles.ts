// 채널·DM 의 AI 작업 중 유령 버블 상태 훅 — onMessagingProgress 구독 + 새 AGENT 메시지 백스톱 + TTL 스위프.
// 상태 전이 규칙은 @/lib/aiWorkingProgress 의 순수 함수(단위 테스트 대상), 여기는 React 배선만 둔다(WP-412).
// DM 도 채널이므로(channelId === dmId) ChannelPage(A9)·DmPage(#345)가 같은 훅을 쓴다.
import { useEffect, useRef, useState } from 'react'

import { onMessagingProgress } from '@/hooks/useMessageStream'
import {
  applyProgressEvent,
  maxAgentMessageId,
  nextAgentBaseline,
  sweepStaleWorking,
  type WorkingMap,
} from '@/lib/aiWorkingProgress'

/** 스위프 주기 — 10초. TTL(60초) 대비 충분히 촘촘하면서 타이머 비용은 낮다. */
const SWEEP_INTERVAL_MS = 10_000

/**
 * 채널의 진행 중 AI 스트림(streamId → 마지막 이벤트) 맵을 돌려준다.
 *
 * @param channelId 구독할 채널(=DM) id. undefined 면 구독하지 않는다.
 * @param messages 현재 메시지 목록 — 새 AGENT 메시지 도착 판정용.
 * @param messagesLoaded 첫 메시지 조회 완료 여부 — 완료 전엔 기준선을 잡지 않는다(라이브 버블 보호).
 */
export function useAiWorkingBubbles(
  channelId: number | undefined,
  messages: { id: number; authorKind?: string | null }[],
  messagesLoaded: boolean,
): WorkingMap {
  const [working, setWorking] = useState<WorkingMap>(new Map())
  // 종료된(done/error) streamId — 뒤늦은 비종료 이벤트의 버블 부활 차단용(렌더와 무관하므로 ref).
  const endedStreamsRef = useRef<Set<string>>(new Set())
  // 새 AGENT 메시지 판정 기준선 — 채널 첫 로드 시점의 최대 AGENT id(null = 아직 안 잡음).
  const agentBaselineRef = useRef<number | null>(null)

  // 채널 전환 리셋 — Channel/DmPage 라우트는 key 없이 재사용돼 훅 상태가 채널을 넘어 살아남는다.
  // 리셋하지 않으면 A 채널의 유령 버블이 B 채널에 그대로 보인다. 렌더 중 이전 값 비교로 즉시 비워
  // 전환 직후 한 프레임도 이전 채널 버블이 그려지지 않게 한다(React 권장 "이전 렌더 정보 저장" 패턴).
  const [prevChannelId, setPrevChannelId] = useState(channelId)
  if (prevChannelId !== channelId) {
    setPrevChannelId(channelId)
    setWorking(new Map())
  }
  // ref 는 렌더 중 쓰지 않고 effect 에서 비운다. 기준선 effect 보다 먼저 선언돼 같은 커밋에서 먼저 실행되므로,
  // 새 채널 메시지가 이미 캐시돼 있어도 기준선이 새 채널 값으로 다시 잡힌다(버블을 잘못 지우지 않음).
  useEffect(() => {
    endedStreamsRef.current = new Set()
    agentBaselineRef.current = null
  }, [channelId])

  useEffect(() => {
    if (channelId == null) return
    return onMessagingProgress((e) => {
      if (e.channelId !== channelId) return
      setWorking((prev) => applyProgressEvent(prev, endedStreamsRef.current, e, Date.now()))
    })
  }, [channelId])

  // 신규 AGENT 메시지가 도착하면(실제 응답 등장) 모든 유령 버블 제거 — 판정은 nextAgentBaseline.
  const maxAgentMsgId = maxAgentMessageId(messages)
  useEffect(() => {
    if (!messagesLoaded) return
    const { baseline, clear } = nextAgentBaseline(agentBaselineRef.current, maxAgentMsgId)
    agentBaselineRef.current = baseline
    if (clear) setWorking(new Map())
  }, [messagesLoaded, maxAgentMsgId])

  // TTL 안전망: 60초 무수신 유령 제거 (10초마다 스위프)
  useEffect(() => {
    const t = setInterval(() => setWorking((prev) => sweepStaleWorking(prev, Date.now())), SWEEP_INTERVAL_MS)
    return () => clearInterval(t)
  }, [])

  return working
}
