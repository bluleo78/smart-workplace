// 버전 출시·관리 권한(WP-888) — 페이지 테스트(WP-971).
// 출시 대화상자의 선택 → release 요청 본문(moveUnresolvedTo 유무), 멤버의 읽기 전용 화면은 브라우저 없이 판정되므로
// e2e/pages/issue-versions.spec.ts 에서 옮겼다. 훅을 끊지 않고 MSW 로 실제 api → 훅 → 화면을 지난다
// (훅을 vi.mock 한 분기 테스트는 VersionsPage.test.tsx·VersionReleaseDialog.test.tsx).
import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { memberKeys } from '@/hooks/queries/useProjectMembers'
import { BASE, KEY, OWNER_MEMBERS, PLAIN_MEMBERS, versionApi, type VersionApiOptions } from '@/test/msw/versionHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createVersion } from '../../../../e2e/factories/version.factory'

/** 버전 상세(1)를 열고 출시 대화상자를 띄운다 — 끝나지 않은 이슈 수가 와서 선택지가 보인 뒤를 돌려준다. */
async function openRelease(opts: VersionApiOptions) {
  const api = versionApi({ count: { fix: 3, affects: 0, unresolvedFix: 2 }, ...opts })
  const view = renderPage(`/projects/${KEY}/versions/1`, { handlers: api.handlers })
  await view.user.click(await screen.findByTestId('version-release', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  const dialog = await screen.findByTestId('version-release-dialog')
  expect(await within(dialog).findByTestId('version-release-unresolved')).toHaveTextContent('2건')
  return { ...view, api, dialog }
}

describe('출시 대화상자 → release 요청', () => {
  test('다음 버전으로 옮기기에서 대상을 바꾸면 release 본문에 그 버전이 moveUnresolvedTo 로 실리고 출시됨으로 바뀐다', async () => {
    const { user, api, dialog } = await openRelease({
      versions: [
        createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-12-01' }),
        createVersion({ id: 2, name: '1.1.0', releaseDate: '2027-01-15' }),
        createVersion({ id: 3, name: '2.0.0' }),
      ],
    })
    expect(within(dialog).getByTestId('version-release-date')).toHaveValue('2026-12-01')
    // 기본 대상은 목록 순서상 다음 미출시 버전.
    expect(within(dialog).getByTestId('version-release-target')).toHaveTextContent('1.1.0')
    await user.click(within(dialog).getByTestId('version-release-target'))
    await user.click(await screen.findByRole('option', { name: '2.0.0' }))
    await user.click(within(dialog).getByTestId('version-release-submit'))

    await waitFor(() =>
      expect(api.writes).toEqual([
        { method: 'POST', path: `${BASE}/versions/1/release`, body: { releaseDate: '2026-12-01', moveUnresolvedTo: 3 } },
      ]),
    )
    expect(await screen.findByText('버전을 출시했어요')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('version-release-dialog')).not.toBeInTheDocument())
    // 재조회가 출시됨을 받아 「출시 취소」 로 바뀐다.
    expect(await screen.findByTestId('version-unrelease')).toBeInTheDocument()
  })

  test('그대로 두기를 고르면 대상 선택이 사라지고 release 본문에 moveUnresolvedTo 가 없다', async () => {
    const { user, api, dialog } = await openRelease({
      versions: [createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-12-01' }), createVersion({ id: 2, name: '1.1.0' })],
    })
    await user.click(within(dialog).getByLabelText('그대로 두기'))
    expect(within(dialog).queryByTestId('version-release-target')).not.toBeInTheDocument()
    await user.click(within(dialog).getByTestId('version-release-submit'))

    await waitFor(() =>
      expect(api.writes).toEqual([{ method: 'POST', path: `${BASE}/versions/1/release`, body: { releaseDate: '2026-12-01' } }]),
    )
  })
})

describe('버전 목록 — 관리 권한', () => {
  /** 같은 데이터로 목록을 열고 행이 그려지고 구성원 응답이 나간 뒤를 돌려준다 — 그 전의 「없음」 은 권한 판정 전이라 의미가 없다. */
  async function openList(members: VersionApiOptions['members']) {
    const api = versionApi({ versions: [createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-12-01' })], members })
    const view = renderPage(`/projects/${KEY}/versions`, { handlers: api.handlers })
    expect(await screen.findByTestId('version-row-1', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('1.0.0')
    // 구성원 응답이 캐시에 들어가고(권한 판정 입력) 그 결과로 다시 그려질 때까지 기다린다.
    await waitFor(() => expect(view.queryClient.getQueryState(memberKeys.all(KEY))?.status).toBe('success'))
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    return view
  }

  test('소유자는 만들기와 행 ⋯ 메뉴가 보인다(양성 대조)', async () => {
    await openList(OWNER_MEMBERS)
    expect(await screen.findByTestId('version-new')).toBeInTheDocument()
    expect(screen.getByTestId('version-menu-1')).toBeInTheDocument()
  })

  test('일반 멤버는 같은 목록을 읽기만 한다 — 만들기·⋯ 메뉴가 없다', async () => {
    await openList(PLAIN_MEMBERS)
    expect(screen.queryByTestId('version-new')).not.toBeInTheDocument()
    expect(screen.queryByTestId('version-menu-1')).not.toBeInTheDocument()
  })
})
