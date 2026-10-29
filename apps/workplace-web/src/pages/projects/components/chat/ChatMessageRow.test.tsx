// 이슈 채팅 행 — AI 글의 멘션도 사람 글과 똑같은 칩으로 보인다(WP-1009). 예전에는 AI 글(마크다운)이 <@id> 를 글자 그대로 보였다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/renderWithProviders'

import { createChatMention, createChatMessage } from '../../../../../e2e/factories/chat.factory'
import { ChatMessageRow } from './ChatMessageRow'

const kim = createChatMention({ id: 7, username: 'kim', name: '김철수', kind: 'HUMAN' })
const leader = createChatMention({ id: 9, username: 'teamleader', name: 'AI 팀장', kind: 'AGENT' })

function renderRow(authorKind: 'HUMAN' | 'AGENT', id: number) {
  const message = createChatMessage({
    id,
    authorKind,
    authorName: authorKind === 'AGENT' ? '코디' : '양동희',
    body: '<@7> <@9> 리뷰 부탁해요',
    mentions: [kim, leader],
  })
  renderWithProviders(<ChatMessageRow message={message} isOwn={false} canEdit={false} />)
  return screen.getByTestId(`chat-message-body-${id}`)
}

describe('ChatMessageRow 멘션 칩 (WP-1009)', () => {
  it('AI 글의 멘션 토큰을 이름 칩으로 보이고 <@id> 를 남기지 않는다', () => {
    const body = renderRow('AGENT', 1)
    expect(body).toHaveTextContent('@김철수 @AI 팀장 리뷰 부탁해요')
    expect(body.textContent).not.toContain('<@')
  })

  it('AI 글의 칩은 사람 글의 칩과 모양(클래스)이 같다 — 사람·AI 멘션 모두', () => {
    const agentBody = renderRow('AGENT', 1)
    const humanBody = renderRow('HUMAN', 2)
    for (const id of [7, 9]) {
      const inAgent = agentBody.querySelector(`[data-testid="chat-mention-chip-${id}"]`)
      const inHuman = humanBody.querySelector(`[data-testid="chat-mention-chip-${id}"]`)
      expect(inAgent).not.toBeNull()
      expect(inAgent?.className).toBe(inHuman?.className)
      expect(inAgent?.textContent).toBe(inHuman?.textContent)
    }
  })
})

describe('ChatMessageRow 앱 링크 카드 (WP-896)', () => {
  it('이슈 채팅에도 같은 호스트의 이슈 링크 아래 카드가 붙고, 지우기 ✕ 는 없다', async () => {
    server.use(
      http.get('/api/v1/app-links/issues/:key/:number', () =>
        HttpResponse.json({ kind: 'ISSUE', title: '관련 이슈', issueKey: 'WP-12', statusName: '완료', statusCategory: 'DONE', assignees: [], priority: 'MID' }),
      ),
    )
    const message = createChatMessage({ id: 5, body: '이것도 보세요 http://localhost/projects/wp/issues/12', mentions: [] })
    renderWithProviders(<ChatMessageRow message={message} isOwn canEdit />)
    await waitFor(() => expect(screen.getByTestId('app-link-5-0')).toHaveAttribute('data-state', 'ready'))
    const card = screen.getByTestId('app-link-5-0')
    expect(card).toHaveTextContent('WP-12')
    expect(card).toHaveTextContent('완료')
    expect(card).toHaveTextContent('관련 이슈')
    // 프로젝트 키는 대문자로 맞춰 이동한다.
    expect(card).toHaveAttribute('href', '/projects/WP/issues/12')
    expect(screen.queryByTestId('link-preview-dismiss-5')).not.toBeInTheDocument()
  })
})
