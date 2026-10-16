// AI 작업 중 유령 버블 상태 전이 단위 테스트(WP-412). 이슈 채팅 이벤트 모양도 같은 함수로 다룬다(WP-418).
// 이전 E2E messaging-progress-keep(HUMAN 도착엔 유지, #346)를 대체한다. SSE → 버블 표시/제거 배선은
// messaging-progress(.dm).spec, done 뒤 늦은 이벤트가 훅의 종료 기록(ref)을 거치는 배선은 messaging-progress-stale.spec 이 지킨다.
import { describe, expect, it } from 'vitest'

import type { ChatProgressEvent } from '@/hooks/useChatStream'
import type { MessagingProgressEvent } from '@/hooks/useMessageStream'

import {
  applyProgressEvent,
  maxAgentMessageId,
  nextAgentBaseline,
  sweepStaleWorking,
  type WorkingMap,
} from './aiWorkingProgress'

const ev = (phase: MessagingProgressEvent['phase'], streamId = 's1'): MessagingProgressEvent => ({
  channelId: 52,
  streamId,
  agentName: 'AI',
  phase,
  steps: [{ label: '답변 작성', status: phase === 'tool' ? 'running' : 'done' }],
})

describe('applyProgressEvent', () => {
  it('started/tool 은 버블을 만들고 최신 이벤트로 갱신한다', () => {
    const ended = new Set<string>()
    let w: WorkingMap<MessagingProgressEvent> = new Map()
    w = applyProgressEvent(w, ended, ev('started'), 1)
    w = applyProgressEvent(w, ended, ev('tool'), 2)
    expect(w.size).toBe(1)
    expect(w.get('s1')).toMatchObject({ phase: 'tool', at: 2 })
  })

  it('done/error 는 해당 스트림 버블만 지운다', () => {
    const ended = new Set<string>()
    let w: WorkingMap<MessagingProgressEvent> = new Map()
    w = applyProgressEvent(w, ended, ev('tool', 'a'), 1)
    w = applyProgressEvent(w, ended, ev('tool', 'b'), 1)
    w = applyProgressEvent(w, ended, ev('done', 'a'), 2)
    expect([...w.keys()]).toEqual(['b'])
    w = applyProgressEvent(w, ended, ev('error', 'b'), 3)
    expect(w.size).toBe(0)
  })

  it('종료된 스트림의 뒤늦은 tool 이벤트는 버블을 부활시키지 않는다(순서 역전)', () => {
    const ended = new Set<string>()
    let w: WorkingMap<MessagingProgressEvent> = applyProgressEvent(new Map(), ended, ev('tool'), 1)
    w = applyProgressEvent(w, ended, ev('done'), 2)
    w = applyProgressEvent(w, ended, ev('tool'), 3)
    w = applyProgressEvent(w, ended, ev('started'), 4)
    expect(w.size).toBe(0)
    // 다른 스트림은 영향 없음
    expect(applyProgressEvent(w, ended, ev('tool', 'other'), 5).has('other')).toBe(true)
  })

  it('이전 맵을 변경하지 않는다(React 상태 불변)', () => {
    const prev: WorkingMap<MessagingProgressEvent> = new Map()
    applyProgressEvent(prev, new Set(), ev('tool'), 1)
    expect(prev.size).toBe(0)
  })
})

// 이슈 채팅(ChatProgressEvent: channelId 대신 threadId)도 같은 순수 함수를 쓴다(WP-418) — 예전 이슈 채팅 사본 리듀서엔
// 종료 스트림 기록이 없어 done 뒤 늦은 tool 이 버블을 60초간 되살렸다.
describe('applyProgressEvent — 이슈 채팅 이벤트(WP-418)', () => {
  const chatEv = (phase: ChatProgressEvent['phase'], streamId = 'c1'): ChatProgressEvent => ({
    threadId: 100,
    streamId,
    agentName: 'AI',
    phase,
    steps: [{ label: '위키 검색', status: 'running' }],
  })

  it('threadId·steps 를 그대로 실어 버블을 만든다', () => {
    const w: WorkingMap<ChatProgressEvent> = applyProgressEvent(new Map(), new Set(), chatEv('tool'), 7)
    expect(w.get('c1')).toEqual({ ...chatEv('tool'), at: 7 })
  })

  it('done 뒤 늦게 도착한 tool·started 는 무시한다', () => {
    const ended = new Set<string>()
    let w: WorkingMap<ChatProgressEvent> = applyProgressEvent(new Map(), ended, chatEv('started'), 1)
    w = applyProgressEvent(w, ended, chatEv('done'), 2)
    w = applyProgressEvent(w, ended, chatEv('tool'), 3)
    w = applyProgressEvent(w, ended, chatEv('started'), 4)
    expect(w.size).toBe(0)
  })

  it('TTL 스위프도 같은 규칙으로 동작한다', () => {
    const w: WorkingMap<ChatProgressEvent> = applyProgressEvent(new Map(), new Set(), chatEv('tool'), 0)
    expect(sweepStaleWorking(w, 60_001).size).toBe(0)
  })
})

describe('maxAgentMessageId / nextAgentBaseline (#346)', () => {
  it('AGENT 메시지 중 최대 id 만 본다', () => {
    expect(maxAgentMessageId([])).toBe(0)
    expect(
      maxAgentMessageId([
        { id: 5, authorKind: 'AGENT' },
        { id: 9, authorKind: 'HUMAN' },
        { id: 7, authorKind: 'AGENT' },
      ]),
    ).toBe(7)
  })

  it('첫 로드는 기준선만 잡고 버블을 지우지 않는다', () => {
    expect(nextAgentBaseline(null, 7)).toEqual({ baseline: 7, clear: false })
    expect(nextAgentBaseline(null, 0)).toEqual({ baseline: 0, clear: false })
  })

  it('HUMAN 메시지 도착·스크롤백(최대 AGENT id 그대로)에는 유지, 새 AGENT 메시지에만 지운다', () => {
    // HUMAN 메시지가 와도 최대 AGENT id 는 그대로 → 유지
    const humanArrived = maxAgentMessageId([{ id: 10, authorKind: 'HUMAN' }])
    expect(nextAgentBaseline(0, humanArrived)).toEqual({ baseline: 0, clear: false })
    // 과거 AGENT 메시지 prepend(기준선 이하) → 유지
    expect(nextAgentBaseline(7, 3)).toEqual({ baseline: 7, clear: false })
    // 새 AGENT 메시지 → 제거
    expect(nextAgentBaseline(0, 11)).toEqual({ baseline: 11, clear: true })
  })
})

describe('sweepStaleWorking', () => {
  it('TTL 넘게 무수신인 버블만 빼고, 바뀐 게 없으면 같은 참조를 돌려준다', () => {
    const ended = new Set<string>()
    let w: WorkingMap<MessagingProgressEvent> = applyProgressEvent(new Map(), ended, ev('tool', 'old'), 0)
    w = applyProgressEvent(w, ended, ev('tool', 'fresh'), 50_000)
    expect(sweepStaleWorking(w, 59_000)).toBe(w)
    expect([...sweepStaleWorking(w, 60_001).keys()]).toEqual(['fresh'])
  })
})
