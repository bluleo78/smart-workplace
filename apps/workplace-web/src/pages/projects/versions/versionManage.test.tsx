// 버전 출시·관리 권한(WP-888) — 페이지 테스트(WP-971).
// 출시 대화상자의 선택 → release 요청 본문(moveUnresolvedTo 유무), 멤버의 읽기 전용 화면은 브라우저 없이 판정되므로
// e2e/pages/issue-versions.spec.ts 에서 옮겼다. 훅을 끊지 않고 MSW 로 실제 api → 훅 → 화면을 지난다
// (훅을 vi.mock 한 분기 테스트는 VersionsPage.test.tsx·VersionReleaseDialog.test.tsx).
// 버전 상세·목록 화면만 renderScreen 으로 띄운다 — 앱 셸·인증 부팅은 건너뛴다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import VersionDetailPage from '@/pages/projects/versions/VersionDetailPage'
import VersionsPage from '@/pages/projects/versions/VersionsPage'
import { atRoute } from '@/test/kits/projects/atRoute'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { settleMembers } from '@/test/msw/projectMetaHandlers'
import { BASE, KEY, OWNER_MEMBERS, PLAIN_MEMBERS, versionApi, type VersionApiOptions } from '@/test/msw/versionHandlers'
import { renderScreen } from '@/test/renderScreen'

import { createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'
import { createVersion } from '../../../../e2e/factories/version.factory'

/** 버전 상세(1)를 열고 출시 대화상자를 띄운다 — 끝나지 않은 이슈 수가 와서 선택지가 보인 뒤를 돌려준다. */
async function openRelease(opts: VersionApiOptions) {
  const api = versionApi({ count: { fix: 3, affects: 0, unresolvedFix: 2 }, ...opts })
  const view = renderScreen(atRoute('/projects/:key/versions/:versionId', <VersionDetailPage />), {
    path: `/projects/${KEY}/versions/1`,
    handlers: [...api.handlers, ...shellHandlers],
  })
  await view.user.click(await screen.findByTestId('version-release'))
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
    // 데스크톱은 헤더에 상태 배지가 있어 본문에 모바일용 배지를 또 그리지 않는다(WP-1089).
    expect(within(screen.getByTestId('page-header')).getByText('출시됨')).toBeInTheDocument()
    expect(screen.queryByTestId('version-status-mobile')).not.toBeInTheDocument()
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
    const view = renderScreen(atRoute('/projects/:key/versions', <VersionsPage />), {
      path: `/projects/${KEY}/versions`,
      handlers: [...api.handlers, ...shellHandlers],
    })
    expect(await screen.findByTestId('version-row-1')).toHaveTextContent('1.0.0')
    await settleMembers(view)
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

describe('버전 상세 — 이슈가 없을 때', () => {
  // 진행률 자리와 「이 버전에 나가는 것」 탭이 같은 빈 안내를 위아래로 두 번 보였다(WP-1136). 탭 아래에만 한 번 보인다.
  test('빈 안내 문장은 탭 아래에 한 번만 보이고 진행률 막대는 그리지 않는다', async () => {
    const api = versionApi({ versions: [createVersion({ id: 1, name: '1.0.0' })] })
    renderScreen(atRoute('/projects/:key/versions/:versionId', <VersionDetailPage />), {
      path: `/projects/${KEY}/versions/1`,
      // 이슈 검색은 빈 결과 — api 기본 핸들러(이슈 한 건)보다 앞에 둔다.
      handlers: [http.get(`${BASE}/issues`, () => HttpResponse.json(createIssueSearchResponse([], null))), ...api.handlers, ...shellHandlers],
    })
    const tab = await screen.findByTestId('version-issues-fixVersion')
    expect(await within(tab).findByText('이 버전에 나가는 이슈가 아직 없어요.')).toBeInTheDocument()
    expect(screen.getAllByText('이 버전에 나가는 이슈가 아직 없어요.')).toHaveLength(1)
    expect(screen.queryByTestId('version-progress')).not.toBeInTheDocument()
  })

  test('이슈가 있으면 진행률 막대와 완료/전체를 그린다(양성 대조)', async () => {
    const api = versionApi({ versions: [createVersion({ id: 1, name: '1.0.0', progress: { done: 1, inProgress: 1, todo: 2 } })] })
    renderScreen(atRoute('/projects/:key/versions/:versionId', <VersionDetailPage />), {
      path: `/projects/${KEY}/versions/1`,
      handlers: [...api.handlers, ...shellHandlers],
    })
    expect(await screen.findByTestId('version-progress')).toHaveTextContent('1/4 · 25%')
  })
})
