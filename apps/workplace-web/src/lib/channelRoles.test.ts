// 채널 역할 선택지 단위 테스트(WP-412) — 이전 E2E chat-members(AGENT 역할 select 에 OWNER 없음, #598)를 대체.
import { describe, expect, it } from 'vitest'

import { assignableChannelRoles } from './channelRoles'

describe('assignableChannelRoles', () => {
  it('사람은 OWNER·ADMIN·MEMBER 모두', () => {
    expect(assignableChannelRoles('HUMAN')).toEqual(['OWNER', 'ADMIN', 'MEMBER'])
  })
  it('AGENT(AI 봇)는 OWNER 로 지정할 수 없다', () => {
    expect(assignableChannelRoles('AGENT')).toEqual(['ADMIN', 'MEMBER'])
  })
})
