// 이슈 상세 링크 복사(WP-1234) — 데스크톱 헤더 🔗 와 ⋯ 「키 복사」. 화면 테스트(이슈 상세만 renderScreen 으로).
// 모바일 ⬆︎ 공유 시트는 뷰포트가 달라 issueLinkShareMobile.test.tsx 에 둔다.
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test } from 'vitest'

import { closeSendToChat, sendToChatTarget } from '@/lib/sendToChat'
import { openIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'

import { createComment, createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

// 「채팅·이슈로 보내기」(WP-1235) 대화상자는 앱 셸 호스트가 그린다 — 여기선 열린 대상(스토어)만 본다.
afterEach(() => {
  act(() => closeSendToChat())
})

test('🔗 를 누르면 이 이슈의 절대 링크를 복사하고 토스트를 띄운다', async () => {
  const { user } = await openIssueDetailScreen({ key: 'WP', number: 42 })
  // 툴팁·접근 이름에 단축키를 함께 알린다(jsdom 은 플랫폼 문자열이 비어 Ctrl 표기).
  await user.click(screen.getByRole('button', { name: /^링크 복사 (⇧⌘,|Ctrl\+Shift\+,)$/ }))
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/projects/WP/issues/42`))
  expect(await screen.findByText('링크를 복사했어요')).toBeInTheDocument()
})

test('복사 토스트의 「채팅으로 보내기」는 이 이슈를 보낼 대상으로 「채팅·이슈로 보내기」를 연다(WP-1235)', async () => {
  const { user } = await openIssueDetailScreen({ key: 'WP', number: 42 })
  await user.click(screen.getByRole('button', { name: /^링크 복사 / }))
  await user.click(await screen.findByRole('button', { name: '채팅으로 보내기' }))
  await waitFor(() =>
    expect(sendToChatTarget()).toMatchObject({ kind: 'issue', url: `${window.location.origin}/projects/WP/issues/42`, key: 'WP-42' }),
  )
})

test('⋯ 는 키 복사 · 채팅·이슈로 보내기… 순서이고, 보내기는 이 이슈로 대화상자를 연다(WP-1235)', async () => {
  const { user } = await openIssueDetailScreen({ key: 'WP', number: 42 })
  await user.click(screen.getByTestId('issue-link-menu'))
  const items = await screen.findAllByRole('menuitem')
  expect(items.map((i) => i.textContent?.trim())).toEqual([expect.stringMatching(/^키 복사/), '채팅·이슈로 보내기…'])
  await user.click(screen.getByTestId('menu-send-to-chat'))
  await waitFor(() => expect(sendToChatTarget()?.url).toBe(`${window.location.origin}/projects/WP/issues/42`))
})

test('코멘트 본문의 앱 링크는 채팅과 같은 카드로 보이고 누르면 그 대상으로 간다(WP-1235)', async () => {
  // 노트 링크 — 누른 뒤 이 화면(이슈 상세 라우트) 밖으로 나가 다른 화면 조회가 붙지 않게.
  const link = `${window.location.origin}/wiki/open/3`
  const detail = createIssueDetail({
    summary: createIssue({ id: 100, projectKey: 'WP', number: 42 }),
    comments: [createComment({ id: 5, body: `이거 봐 주세요\n${link}` })],
  })
  const { user, location } = await openIssueDetailScreen({
    key: 'WP',
    number: 42,
    detail,
    handlers: [http.get('/api/v1/app-links/pages/3', () => HttpResponse.json({ kind: 'PAGE', title: '릴리스 체크리스트', spaceName: '개발' }))],
  })
  // 받는 동안의 빈 자리가 카드로 바뀐다(요소가 갈린다) — 매번 다시 찾는다.
  await screen.findByTestId('comment-app-link-5-0', {}, { timeout: 10_000 })
  await waitFor(() => expect(screen.getByTestId('comment-app-link-5-0')).toHaveAttribute('data-state', 'ready'))
  expect(screen.getByTestId('comment-app-link-5-0')).toHaveTextContent('릴리스 체크리스트')
  await user.click(screen.getByTestId('comment-app-link-5-0'))
  expect(location()).toBe('/wiki/open/3')
})

test('⋯ 「키 복사」는 이슈 키를 복사한다 — 일반 브라우저에선 「브라우저에서 열기」가 없다', async () => {
  const { user } = await openIssueDetailScreen({ key: 'WP', number: 42 })
  await user.click(screen.getByTestId('issue-link-menu'))
  expect(screen.queryByTestId('menu-open-in-browser')).not.toBeInTheDocument()
  await user.click(await screen.findByTestId('menu-copy-key'))
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('WP-42'))
  expect(await screen.findByText('키를 복사했어요')).toBeInTheDocument()
})

test('설치된 앱(standalone)이면 ⋯ 에 「브라우저에서 열기」가 있고 새 창으로 이 이슈를 연다', async () => {
  // iOS 홈 화면 앱 표식(navigator.standalone)으로 설치된 앱을 흉내 낸다.
  Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
  const opened: unknown[][] = []
  const realOpen = window.open
  window.open = ((...args: unknown[]) => {
    opened.push(args)
    return null
  }) as typeof window.open
  try {
    const { user } = await openIssueDetailScreen({ key: 'WP', number: 42 })
    await user.click(screen.getByTestId('issue-link-menu'))
    await user.click(await screen.findByTestId('menu-open-in-browser'))
    expect(opened).toEqual([[`${window.location.origin}/projects/WP/issues/42`, '_blank', 'noopener']])
  } finally {
    delete (navigator as Navigator & { standalone?: boolean }).standalone
    window.open = realOpen
  }
})
