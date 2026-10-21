// 채널·DM @멘션 후보 조립·AI 게이트 단위 테스트(WP-412). 이전 E2E chat/mention-ai-gate 를 대체한다.
import { describe, expect, it } from 'vitest'

import { channelMentionCandidates } from './mentionCandidates'

const members = [
  { userId: 1, name: '나', kind: 'HUMAN' as const },
  { userId: 99, name: 'AI', kind: 'AGENT' as const },
]
const agents = [
  { userId: 99, username: 'aibot', name: 'AI(디렉터리)', kind: 'AGENT' as const },
  { userId: 100, username: 'helper', name: '도우미', kind: 'AGENT' as const },
]

describe('channelMentionCandidates', () => {
  it('aiAvailable 이면 채널 멤버 ∪ 비멤버 AGENT, userId 중복은 멤버 정보 우선', () => {
    expect(channelMentionCandidates(members, agents, true)).toEqual([
      { userId: 1, username: '나', name: '나', kind: 'HUMAN' },
      { userId: 99, username: 'AI', name: 'AI', kind: 'AGENT' },
      { userId: 100, username: 'helper', name: '도우미', kind: 'AGENT' },
    ])
  })

  it('aiAvailable=false 이면 채널 멤버인 AGENT 도 후보에서 빠진다', () => {
    expect(channelMentionCandidates(members, agents, false).map((m) => m.userId)).toEqual([1])
  })

  it('조회 전(undefined)이면 빈 후보', () => {
    expect(channelMentionCandidates(undefined, undefined, true)).toEqual([])
  })
})

describe('channelMentionCandidates (DM — 참여자만, agents 없음)', () => {
  it('aiAvailable=false 면 AGENT 만 제외하고 사람은 유지', () => {
    expect(channelMentionCandidates(members, undefined, false).map((m) => m.userId)).toEqual([1])
    expect(channelMentionCandidates(members, undefined, true).map((m) => m.userId)).toEqual([1, 99])
  })
})

describe('channelMentionCandidates — 정지된 구성원 (WP-723)', () => {
  it('active=false 인 멤버는 후보에서 빠지고, 필드가 없거나 true 면 남는다', () => {
    const ms = [
      { userId: 1, name: '나', kind: 'HUMAN' as const },
      { userId: 2, name: '퇴사자', kind: 'HUMAN' as const, active: false },
      { userId: 3, name: '밥', kind: 'HUMAN' as const, active: true },
    ]
    expect(channelMentionCandidates(ms, undefined, true).map((m) => m.userId)).toEqual([1, 3])
  })
})
