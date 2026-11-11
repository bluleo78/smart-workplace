// 이슈챗 @ 후보 합치기(WP-1492) — 참여자 + 프로젝트 AI, 중복 제거, 남의 개인 비서·비활성 AI 제외, 비참여 사람은 안 들어감.
import { describe, expect, it } from 'vitest'

import { createChatMember } from '../../../../../e2e/factories/chat.factory'
import { createAgentMember, createMember } from '../../../../../e2e/factories/project.factory'
import { isOthersPersonalAssistant, issueChatMentionCandidates } from './issueChatMentionCandidates'

const ME = 1

describe('issueChatMentionCandidates', () => {
  const me = createChatMember({ userId: ME, username: 'me', name: '나', kind: 'HUMAN' })

  it('참여자 뒤에 비참여 프로젝트 AI 를 붙이고, 비참여 사람은 넣지 않는다', () => {
    const result = issueChatMentionCandidates(
      [me],
      [
        createMember({ userId: ME, username: 'me', name: '나' }),
        createMember({ userId: 2, username: 'kim', name: '김사람' }),
        createAgentMember({ userId: 50, username: 'codi', name: '코디' }),
      ],
      ME,
    )
    expect(result).toEqual([
      { userId: ME, username: 'me', name: '나', kind: 'HUMAN' },
      { userId: 50, username: 'codi', name: '코디', kind: 'AGENT' },
    ])
  })

  it('이미 참여자인 AI 는 한 번만 — 참여자 쪽 값을 쓴다', () => {
    const joined = createChatMember({ userId: 50, username: 'codi', name: '코디(참여)', kind: 'AGENT' })
    const result = issueChatMentionCandidates([me, joined], [createAgentMember({ userId: 50, username: 'codi', name: '코디' })], ME)
    expect(result.map((c) => [c.userId, c.name])).toEqual([
      [ME, '나'],
      [50, '코디(참여)'],
    ])
  })

  it('남의 개인 비서는 프로젝트 쪽이든 참여자 쪽이든 빼고, 내 개인 비서는 남긴다', () => {
    const othersInThread = createChatMember({ userId: 61, username: '__assistant_u7', name: '남의 비서(참여)', kind: 'AGENT' })
    const result = issueChatMentionCandidates(
      [me, othersInThread],
      [
        createAgentMember({ userId: 60, username: `__assistant_u${ME}`, name: '내 비서' }),
        createAgentMember({ userId: 62, username: '__assistant_u8', name: '남의 비서' }),
        createAgentMember({ userId: 61, username: '__assistant_u7', name: '남의 비서(참여)' }),
      ],
      ME,
    )
    expect(result.map((c) => c.userId)).toEqual([ME, 60])
  })

  it('비활성 AI(active=false)는 빼고, 프로젝트 멤버를 아직 못 받았으면 참여자만', () => {
    expect(
      issueChatMentionCandidates([me], [createAgentMember({ userId: 70, username: 'off', name: '꺼진 AI', active: false })], ME),
    ).toEqual([{ userId: ME, username: 'me', name: '나', kind: 'HUMAN' }])
    expect(issueChatMentionCandidates([me], undefined, ME)).toHaveLength(1)
  })

  it('이미 참여자인 AI 도 프로젝트 멤버 행이 비활성이면 뺀다(참여자 응답엔 active 가 없음)', () => {
    const offInThread = createChatMember({ userId: 70, username: 'off', name: '꺼진 AI', kind: 'AGENT' })
    const result = issueChatMentionCandidates(
      [me, offInThread],
      [createAgentMember({ userId: 70, username: 'off', name: '꺼진 AI', active: false })],
      ME,
    )
    expect(result.map((c) => c.userId)).toEqual([ME])
  })
})

describe('isOthersPersonalAssistant', () => {
  it('서버 AgentUsernames 와 같은 판정 — 접두어 + 다른 주인 id 일 때만 참', () => {
    expect(isOthersPersonalAssistant('__assistant_u2', 1)).toBe(true)
    expect(isOthersPersonalAssistant('__assistant_u1', 1)).toBe(false)
    // 주인 id 가 접두어처럼 겹쳐도(1 vs 12) 전체 일치로 가린다.
    expect(isOthersPersonalAssistant('__assistant_u12', 1)).toBe(true)
    expect(isOthersPersonalAssistant('codi', 1)).toBe(false)
  })
})
