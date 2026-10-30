// 이슈 상세 모바일 ⬆︎ 공유 시트(WP-1234) — 링크 복사·키 복사·다른 앱으로 보내기(Web Share 가 있을 때만).
// 뷰포트가 파일당 하나라 데스크톱(issueLinkShare.test.tsx)과 나눈다. 화면 테스트(이슈 상세만 renderScreen 으로).
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { openIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { mockViewport } from '@/test/viewport'

mockViewport()

const URL_42 = () => `${window.location.origin}/projects/WP/issues/42`

afterEach(() => {
  // 테스트가 깐 Web Share 를 걷는다 — jsdom 엔 원래 없다.
  delete (navigator as Partial<Navigator>).share
})

async function openSheet() {
  const view = await openIssueDetailScreen({ key: 'WP', number: 42 })
  await view.user.click(screen.getByTestId('mobile-share-button'))
  const sheet = await screen.findByTestId('share-sheet')
  return { ...view, sheet }
}

test('⬆︎ 는 이슈 제목을 머리로 한 시트를 열고, 링크 복사는 이 이슈 링크를 복사한다', async () => {
  const { user, sheet } = await openSheet()
  // Web Share 가 없는 브라우저 — 「다른 앱으로 보내기」를 두지 않는다.
  expect(within(sheet).queryByTestId('mobile-action-send')).not.toBeInTheDocument()
  // 노트·드라이브가 아니라 외부 공유 항목도 없다.
  expect(within(sheet).queryByTestId('mobile-action-external-share')).not.toBeInTheDocument()
  await user.click(within(sheet).getByTestId('mobile-action-copy-link'))
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(URL_42()))
  expect(await screen.findByText('링크를 복사했어요')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('share-sheet')).not.toBeInTheDocument())
})

test('키 복사는 이슈 키를 복사한다', async () => {
  const { user, sheet } = await openSheet()
  await user.click(within(sheet).getByTestId('mobile-action-copy-key'))
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('WP-42'))
})

test('Web Share 가 있으면 「다른 앱으로 보내기」가 제목·링크로 시스템 공유를 부른다', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true })
  const { user, sheet } = await openSheet()
  // 시트 머리 = 이슈 제목 — 보낼 제목도 같다.
  const title = within(sheet).getByRole('heading').textContent
  expect(title).toBe(screen.getByTestId('issue-title-heading').querySelector('h1')?.getAttribute('aria-label'))
  await user.click(within(sheet).getByTestId('mobile-action-send'))
  expect(share).toHaveBeenCalledWith({ title, url: URL_42() })
})
