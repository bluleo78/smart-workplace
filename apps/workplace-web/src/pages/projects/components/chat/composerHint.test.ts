import { describe, expect, it } from 'vitest'

import { agentReplyHint, implicitAgentHint } from './composerHint'

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

// WP-1377: 멘션 없이도 답하는 담당 AI 안내 — 답할 차례일 때만 placeholder·아래 한 줄을 낸다.
describe('implicitAgentHint', () => {
  const AI = 7
  const msg = (id: number, authorId: number, deleted = false) => ({ id, authorId, deleted })
  const human = msg(100, 1)
  const aiReply = msg(101, AI)

  it('ALWAYS 면 마지막 글이 사람이어도 안내한다', () => {
    expect(implicitAgentHint({ id: AI, name: '코디', mode: 'ALWAYS' }, [human])).toEqual({
      placeholder: '코디에게 메시지 (Shift+Enter 로 줄바꿈)',
      note: '이 작업의 담당 AI 코디가 멘션 없이도 답합니다',
    })
    expect(implicitAgentHint({ id: AI, name: '코디', mode: 'ALWAYS' }, [])).toBeDefined()
  })
  it('AFTER_AI_REPLY 는 마지막 글이 그 AI 면 안내한다', () => {
    expect(implicitAgentHint({ id: AI, name: '루미봇', mode: 'AFTER_AI_REPLY' }, [human, aiReply])?.note).toBe(
      '이 작업의 담당 AI 루미봇이 멘션 없이도 답합니다',
    )
  })
  it('AFTER_AI_REPLY 는 마지막 글이 사람이면 안내하지 않는다', () => {
    expect(
      implicitAgentHint({ id: AI, name: '코디', mode: 'AFTER_AI_REPLY' }, [aiReply, msg(102, 1)]),
    ).toBeUndefined()
    expect(implicitAgentHint({ id: AI, name: '코디', mode: 'AFTER_AI_REPLY' }, [])).toBeUndefined()
  })
  it('배열 순서가 아니라 서버 id 로 마지막 글을 고른다(목록 페이지는 최신이 앞)', () => {
    expect(implicitAgentHint({ id: AI, name: '코디', mode: 'AFTER_AI_REPLY' }, [aiReply, human])).toBeDefined()
    expect(implicitAgentHint({ id: AI, name: '코디', mode: 'AFTER_AI_REPLY' }, [human, aiReply])).toBeDefined()
  })
  it('작성 시각이 아니라 id 로 고른다 — 시계가 어긋난 시각을 믿지 않는다', () => {
    // 서버 id 가 더 큰 AI 글이 마지막이다. 사람 글의 createdAt 이 더 늦게 찍혀 있어도(낙관적 글의 로컬 시계 등) 무시한다.
    const skewedHuman = { ...msg(100, 1), createdAt: '2099-01-01T00:00:00Z' }
    const aiLater = { ...msg(101, AI), createdAt: '2026-11-05T10:01:00Z' }
    expect(implicitAgentHint({ id: AI, name: '코디', mode: 'AFTER_AI_REPLY' }, [skewedHuman, aiLater])).toBeDefined()
  })
  it('저장 중인 내 낙관적 글(음수 id)은 늘 마지막 글이다', () => {
    // 낙관적 글은 첫 페이지 맨 앞에 들어가고 id 는 음수 — 서버 id 가 더 큰 AI 글이 있어도 방금 보낸 내 글이 마지막이다.
    // 브라우저 시계가 서버보다 늦어 낙관적 글의 createdAt 이 AI 글보다 앞서 찍혀도 마찬가지다.
    const pendingMine = { ...msg(-123456, 1), createdAt: '2026-11-05T09:00:00Z' }
    const ai = { ...aiReply, createdAt: '2026-11-05T10:01:00Z' }
    expect(implicitAgentHint({ id: AI, name: '코디', mode: 'AFTER_AI_REPLY' }, [pendingMine, ai, human])).toBeUndefined()
    expect(implicitAgentHint({ id: AI, name: '코디', mode: 'AFTER_AI_REPLY' }, [ai, human, pendingMine])).toBeUndefined()
  })
  it('삭제된 마지막 글은 건너뛴다(서버의 직전 글 판정과 같게)', () => {
    const deletedHuman = msg(102, 1, true)
    expect(implicitAgentHint({ id: AI, name: '코디', mode: 'AFTER_AI_REPLY' }, [human, aiReply, deletedHuman])).toBeDefined()
    const deletedAi = msg(102, AI, true)
    expect(implicitAgentHint({ id: AI, name: '코디', mode: 'AFTER_AI_REPLY' }, [human, deletedAi])).toBeUndefined()
  })
  it('터치 셸은 Shift+Enter 안내를 뺀다', () => {
    expect(implicitAgentHint({ id: AI, name: 'Claude', mode: 'ALWAYS' }, [], true)).toEqual({
      placeholder: 'Claude에게 메시지',
      note: '이 작업의 담당 AI Claude이(가) 멘션 없이도 답합니다',
    })
  })
  it('담당 AI 가 없으면 안내 없음', () => {
    expect(implicitAgentHint(null, [aiReply])).toBeUndefined()
    expect(implicitAgentHint(undefined, [aiReply])).toBeUndefined()
  })
})
