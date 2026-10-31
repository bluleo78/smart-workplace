// 이슈 상세 링크 복사(WP-1234) — 데스크톱 헤더 🔗 와 ⋯ 「키 복사」. 화면 테스트(이슈 상세만 renderScreen 으로).
// 모바일 ⬆︎ 공유 시트는 뷰포트가 달라 issueLinkShareMobile.test.tsx 에 둔다.
import { screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'

import { openIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'

test('🔗 를 누르면 이 이슈의 절대 링크를 복사하고 토스트를 띄운다', async () => {
  const { user } = await openIssueDetailScreen({ key: 'WP', number: 42 })
  // 툴팁·접근 이름에 단축키를 함께 알린다(jsdom 은 플랫폼 문자열이 비어 Ctrl 표기).
  await user.click(screen.getByRole('button', { name: /^링크 복사 (⇧⌘,|Ctrl\+Shift\+,)$/ }))
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/projects/WP/issues/42`))
  expect(await screen.findByText('링크를 복사했어요')).toBeInTheDocument()
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
