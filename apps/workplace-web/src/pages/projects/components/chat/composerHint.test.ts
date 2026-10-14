import { describe, expect, it } from 'vitest'

import { agentReplyHint } from './composerHint'

describe('agentReplyHint', () => {
  it('받침 없는 이름은 「가」', () => {
    expect(agentReplyHint('코디')).toBe('답변 입력… 멘션 없이 보내도 코디가 이어받아요')
  })
  it('받침 있는 이름은 「이」', () => {
    expect(agentReplyHint('루미봇')).toBe('답변 입력… 멘션 없이 보내도 루미봇이 이어받아요')
  })
  it('한글로 끝나지 않으면 「이(가)」', () => {
    expect(agentReplyHint('Claude')).toBe('답변 입력… 멘션 없이 보내도 Claude이(가) 이어받아요')
    expect(agentReplyHint('봇2')).toBe('답변 입력… 멘션 없이 보내도 봇2이(가) 이어받아요')
  })
  it('이름이 없으면 안내 없음', () => {
    expect(agentReplyHint(null)).toBeUndefined()
    expect(agentReplyHint('  ')).toBeUndefined()
  })
})
