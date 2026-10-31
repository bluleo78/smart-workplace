// 본문 이슈 키 링크(WP-1237) — 채팅 본문(ChatMarkdownText)·마크다운 본문(MarkdownMessage: 코멘트·AI 글)에서
// 보이는 프로젝트의 평문 이슈 키만 링크가 되고(코드·URL·링크·멘션 안은 그대로), 호버(마우스)·탭(터치)으로 미리보기가 뜨는지 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MarkdownMessage } from '@/components/ai/MarkdownMessage'
import { ChatMarkdownText, type RenderMention } from '@/components/chat/ChatMarkdownText'
import type { MentionUser } from '@/components/mentions/types'
import { renderScreen } from '@/test/renderScreen'

import { createProject } from '../../../e2e/factories/project.factory'
import { renderIssueKeyRef } from './renderIssueKeyRef'

// 포인터 종류 — 한 파일에서 마우스·터치를 다 보려고 훅을 바꿔 끼운다(뷰포트 목은 파일당 하나라 쓰지 않는다).
const pointer = vi.hoisted(() => ({ coarse: false }))
vi.mock('@/hooks/useIsCoarsePointer', () => ({ useIsCoarsePointer: () => pointer.coarse }))

const API = '/api/v1'
const mentions: MentionUser[] = [{ id: 7, name: 'WP-99', kind: 'HUMAN' }]
const chip: RenderMention = (m, key) => (
  <span key={key} data-testid={`chip-${m.id}`}>
    @{m.name}
  </span>
)

/** 보이는 프로젝트는 WP 하나 — AB 는 모르는(볼 수 없는) 프로젝트. 카드 요청은 모아 둔다. */
function handlers(cardRequests: string[] = []) {
  return [
    http.get(`${API}/projects`, () =>
      HttpResponse.json({ content: [createProject({ key: 'WP' })], page: 0, size: 100, totalElements: 1, totalPages: 1 }),
    ),
    http.get(`${API}/app-links/issues/:key/:number`, ({ params }) => {
      cardRequests.push(`${params.key}-${params.number}`)
      if (params.number === '404') return new HttpResponse(null, { status: 404 })
      return HttpResponse.json({
        kind: 'ISSUE',
        title: '로그인 오류 고치기',
        issueKey: `${params.key}-${params.number}`,
        statusName: '진행 중',
        statusCategory: 'IN_PROGRESS',
        assignees: [{ id: 3, username: 'kim', name: '김민준', kind: 'HUMAN' }],
        priority: 'HIGH',
      })
    }),
  ]
}

function renderChat(body: string, cardRequests?: string[]) {
  return renderScreen(
    <div data-testid="body">
      <ChatMarkdownText body={body} mentions={mentions} renderMention={chip} renderIssueRef={renderIssueKeyRef} />
    </div>,
    { handlers: handlers(cardRequests) },
  )
}

function renderMarkdown(body: string, cardRequests?: string[]) {
  return renderScreen(
    <div data-testid="body">
      <MarkdownMessage mentions={mentions} renderMention={chip} renderIssueRef={renderIssueKeyRef}>
        {body}
      </MarkdownMessage>
    </div>,
    { handlers: handlers(cardRequests) },
  )
}

beforeEach(() => {
  pointer.coarse = false
})

describe.each([
  ['채팅 본문(ChatMarkdownText)', renderChat],
  ['마크다운 본문(MarkdownMessage — 코멘트·AI 글)', renderMarkdown],
])('%s', (_name, renderBody) => {
  it('보이는 프로젝트의 키는 이슈 링크, 모르는 프로젝트·소문자는 글자 그대로', async () => {
    renderBody('WP-12 와 (WP-34). AB-5 그리고 wp-6')
    const link = await screen.findByTestId('issue-key-ref-WP-12')
    expect(link).toHaveAttribute('href', '/projects/WP/issues/12')
    expect(link).toHaveTextContent('WP-12')
    expect(screen.getByTestId('issue-key-ref-WP-34')).toHaveTextContent(/^WP-34$/)
    const body = screen.getByTestId('body')
    expect(body).toHaveTextContent('AB-5 그리고 wp-6')
    expect(within(body).getAllByRole('link')).toHaveLength(2)
  })

  it('코드·URL·링크·멘션 안의 키는 건드리지 않는다', async () => {
    renderBody('`WP-1` 와 https://x.test/?k=WP-2 와 www.x.test/#WP-6 와 [WP-3 보기](https://x.test/a) <@7> 그리고 WP-4\n\n```\nWP-5\n```')
    await screen.findByTestId('issue-key-ref-WP-4')
    for (const n of [1, 2, 3, 5, 6]) expect(screen.queryByTestId(`issue-key-ref-WP-${n}`)).toBeNull()
    expect(screen.getByTestId('chip-7')).toHaveTextContent('@WP-99')
    expect(screen.getByTestId('body')).toHaveTextContent('WP-1')
    expect(screen.getByTestId('body')).toHaveTextContent('WP-5')
  })
})

it('마크다운 원문의 밑줄 강조(_WP-12_·__WP-13__) 안 키도 링크가 된다', async () => {
  renderMarkdown('_WP-12_ 와 __WP-13__')
  expect(await screen.findByTestId('issue-key-ref-WP-12')).toBeInTheDocument()
  expect(await screen.findByTestId('issue-key-ref-WP-13')).toBeInTheDocument()
})

describe('마우스 — 호버 미리보기', () => {
  it('올리기 전엔 카드를 받지 않고, 올리면 제목·상태·담당자가 보인다', async () => {
    const requests: string[] = []
    const { user } = renderChat('WP-12 확인', requests)
    const link = await screen.findByTestId('issue-key-ref-WP-12')
    expect(requests).toEqual([])
    await user.hover(link)
    const preview = await screen.findByTestId('issue-key-ref-WP-12-preview', {}, { timeout: 3000 })
    await waitFor(() => expect(preview).toHaveAttribute('data-state', 'ready'))
    expect(screen.getByTestId('issue-key-ref-WP-12-preview-title')).toHaveTextContent('로그인 오류 고치기')
    expect(screen.getByTestId('issue-key-ref-WP-12-preview-key')).toHaveTextContent('WP-12')
    expect(preview).toHaveTextContent('진행 중')
    expect(preview).toHaveTextContent('김민준')
    expect(requests).toEqual(['WP-12'])
  })

  it('없거나 볼 수 없는 이슈는 「이슈를 찾을 수 없어요」', async () => {
    const { user } = renderChat('WP-404 확인')
    await user.hover(await screen.findByTestId('issue-key-ref-WP-404'))
    const preview = await screen.findByTestId('issue-key-ref-WP-404-preview', {}, { timeout: 3000 })
    await waitFor(() => expect(preview).toHaveAttribute('data-state', 'denied'))
    expect(preview).toHaveTextContent('이슈를 찾을 수 없어요')
  })

  it('누르면 이슈 화면으로 이동한다', async () => {
    const { user, location } = renderChat('WP-12 확인')
    await user.click(await screen.findByTestId('issue-key-ref-WP-12'))
    expect(location()).toBe('/projects/WP/issues/12')
  })

  it('카드가 열린 채 링크를 누르면 이동하면서 카드를 닫는다(채팅 패널이 남아 있어도)', async () => {
    const { user, location } = renderChat('WP-12 확인')
    const link = await screen.findByTestId('issue-key-ref-WP-12')
    await user.hover(link)
    await screen.findByTestId('issue-key-ref-WP-12-preview', {}, { timeout: 3000 })
    await user.click(link)
    expect(location()).toBe('/projects/WP/issues/12')
    await waitFor(() => expect(screen.queryByTestId('issue-key-ref-WP-12-preview')).toBeNull())
  })
})

describe('터치 — 탭 미리보기', () => {
  beforeEach(() => {
    pointer.coarse = true
  })

  it('누르면 이동하지 않고 미리보기를 열고, 카드를 누르면 이슈로 간다', async () => {
    const { user, location } = renderMarkdown('WP-12 확인')
    const trigger = await screen.findByTestId('issue-key-ref-WP-12')
    expect(trigger.tagName).toBe('BUTTON')
    await user.click(trigger)
    expect(location()).toBe('/')
    const card = await screen.findByTestId('issue-key-ref-WP-12-preview')
    await waitFor(() => expect(card).toHaveAttribute('data-state', 'ready'))
    expect(card).toHaveTextContent('로그인 오류 고치기')
    await user.click(card)
    expect(location()).toBe('/projects/WP/issues/12')
    await waitFor(() => expect(screen.queryByTestId('issue-key-ref-WP-12-preview')).toBeNull())
  })

  it('없는 이슈는 탭해도 「이슈를 찾을 수 없어요」', async () => {
    const { user } = renderChat('WP-404')
    await user.click(await screen.findByTestId('issue-key-ref-WP-404'))
    expect(await screen.findByText('이슈를 찾을 수 없어요')).toBeInTheDocument()
  })

  it('미리보기를 못 받아도 「이슈 열기」 로 이슈에 가고 팝오버를 닫는다', async () => {
    const { user, location } = renderChat('WP-404')
    await user.click(await screen.findByTestId('issue-key-ref-WP-404'))
    await screen.findByText('이슈를 찾을 수 없어요')
    await user.click(screen.getByTestId('issue-key-ref-WP-404-preview-open'))
    expect(location()).toBe('/projects/WP/issues/404')
    await waitFor(() => expect(screen.queryByTestId('issue-key-ref-WP-404-preview')).toBeNull())
  })

  it('받는 중에도 「이슈 열기」 가 있다', async () => {
    // 카드 요청이 끝나지 않게 붙잡아 받는 중 상태를 본다.
    const { user } = renderScreen(
      <ChatMarkdownText body="WP-12" mentions={mentions} renderMention={chip} renderIssueRef={renderIssueKeyRef} />,
      {
        handlers: [
          http.get(`${API}/app-links/issues/:key/:number`, () => new Promise<never>(() => {})),
          ...handlers(),
        ],
      },
    )
    await user.click(await screen.findByTestId('issue-key-ref-WP-12'))
    const preview = await screen.findByTestId('issue-key-ref-WP-12-preview')
    expect(preview).toHaveAttribute('data-state', 'loading')
    expect(within(preview).getByTestId('issue-key-ref-WP-12-preview-open')).toHaveTextContent('이슈 열기')
  })
})
