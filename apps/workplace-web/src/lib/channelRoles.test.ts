// 채널 역할 선택지 단위 테스트(WP-412) — 이전 E2E chat-members(AGENT 역할 select 에 OWNER 없음, #598)를 대체.
import { describe, expect, it } from 'vitest'

import type { ChannelRole } from '@/types/messaging'

import { assignableChannelRoles, channelRoleLabel } from './channelRoles'

describe('assignableChannelRoles', () => {
  it('사람은 OWNER·ADMIN·MEMBER 모두(active 가 없으면 활성으로 본다)', () => {
    expect(assignableChannelRoles({ kind: 'HUMAN', role: 'MEMBER' })).toEqual(['OWNER', 'ADMIN', 'MEMBER'])
  })
  it('AGENT(AI 봇)는 OWNER 로 지정할 수 없다', () => {
    expect(assignableChannelRoles({ kind: 'AGENT', role: 'MEMBER' })).toEqual(['ADMIN', 'MEMBER'])
  })
  it('정지된 사람은 OWNER 로 지정할 수 없다(WP-1131)', () => {
    expect(assignableChannelRoles({ kind: 'HUMAN', role: 'ADMIN', active: false })).toEqual(['ADMIN', 'MEMBER'])
  })
  it('지금 역할은 걸러져도 남긴다 — 정지된 소유자의 select 가 「관리자」로 보이지 않게(WP-1131)', () => {
    expect(assignableChannelRoles({ kind: 'HUMAN', role: 'OWNER', active: false })).toEqual(['OWNER', 'ADMIN', 'MEMBER'])
  })
})

describe('channelRoleLabel', () => {
  it('역할을 한국어 이름으로, 모르는 역할은 코드 그대로(WP-1131)', () => {
    expect(['OWNER', 'ADMIN', 'MEMBER'].map((r) => channelRoleLabel(r as ChannelRole))).toEqual(['소유자', '관리자', '멤버'])
    expect(channelRoleLabel('GUEST' as ChannelRole)).toBe('GUEST')
  })
})
