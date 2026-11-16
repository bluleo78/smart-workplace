// 버전 출시·관리 권한(WP-888) — 페이지 테스트(WP-971).
// 출시 대화상자의 선택 → release 요청 본문(moveUnresolvedTo 유무), 멤버의 읽기 전용 화면은 브라우저 없이 판정되므로
// e2e/pages/issue-versions.spec.ts 에서 옮겼다. 훅을 끊지 않고 MSW 로 실제 api → 훅 → 화면을 지난다
// (훅을 vi.mock 한 분기 테스트는 VersionsPage.test.tsx·VersionReleaseDialog.test.tsx).
// 버전 상세·목록 화면만 renderScreen 으로 띄운다 — 앱 셸·인증 부팅은 건너뛴다(WP-1002).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import VersionDetailPage from '@/pages/projects/versions/VersionDetailPage'
import { VersionFormDialog } from '@/pages/projects/versions/VersionFormDialog'
import VersionsPage from '@/pages/projects/versions/VersionsPage'
import { expectNoRequest, setBadInput } from '@/test/dateInput'
import { atRoute } from '@/test/kits/projects/atRoute'
import { InProjectTabs } from '@/test/kits/projects/projectTabs'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { settleMembers } from '@/test/msw/projectMetaHandlers'
import { BASE, KEY, OWNER_MEMBERS, PLAIN_MEMBERS, versionApi, type VersionApiOptions, type Write } from '@/test/msw/versionHandlers'
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
    const view = renderScreen(atRoute('/projects/:key/versions', <InProjectTabs><VersionsPage /></InProjectTabs>), {
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

describe('버전 만들기 — 서버 오류 정리 (WP-1558)', () => {
  test('이름 중복으로 거절돼 보인 오류는 이름을 고치면 사라진다', async () => {
    const api = versionApi({ versions: [createVersion({ id: 1, name: '1.0.0' })], members: OWNER_MEMBERS })
    const { user } = renderScreen(atRoute('/projects/:key/versions', <InProjectTabs><VersionsPage /></InProjectTabs>), {
      path: `/projects/${KEY}/versions`,
      handlers: [
        http.post(`${BASE}/versions`, () => HttpResponse.json({ message: '이미 있는 버전 이름입니다: 1.0.0' }, { status: 409 })),
        ...api.handlers,
        ...shellHandlers,
      ],
    })
    await user.click(await screen.findByTestId('version-new'))
    const dialog = await screen.findByTestId('version-form-dialog')
    await user.click(within(dialog).getByTestId('version-name-input'))
    await user.paste('1.0.0')
    await user.click(within(dialog).getByTestId('version-save'))
    expect(await within(dialog).findByTestId('version-form-error')).toHaveTextContent('이미 있는 버전 이름입니다: 1.0.0')

    await user.click(within(dialog).getByTestId('version-name-input'))
    await user.paste('.1')
    expect(within(dialog).queryByTestId('version-form-error')).not.toBeInTheDocument()
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

// WP-1644 — 버전 시작일·출시일을 덜 넣은 채(예: '2026-12-' 까지만) 저장하면 만들기는 날짜가 빠지고, 고치기는 저장된 날짜가 지워졌다.
// <input type="date"> 는 덜 넣은 날짜를 값 '' 로 올려 「비움」과 같아 보이고 빈 칸에서 일부만 치면 change 도 오지 않으므로,
// 입력 요소의 validity.badInput 을 직접 읽어 막는다(공용 lib/dateInput). jsdom 은 덜 넣은 날짜를 칠 수 없어 validity 를 덮어 흉내 낸다.
describe('버전 만들기·고치기 — 덜 넣은 날짜 (WP-1644)', () => {
  const MESSAGE = '날짜를 끝까지 입력하거나 칸을 비워 주세요.'


  /** 버전 폼을 만들기(target 없음) 또는 편집으로 띄운다 — 쓰기 요청(POST·PATCH)을 writes 에 쌓는다. */
  function openForm(target: ReturnType<typeof createVersion> | null = null) {
    const writes: Write[] = []
    const record = (method: string) => async ({ request }: { request: Request }) => {
      writes.push({ method, path: new URL(request.url).pathname, body: await request.json() })
      return HttpResponse.json(target ?? createVersion({ id: 9, name: '새 버전' }))
    }
    const view = renderScreen(<VersionFormDialog projectKey={KEY} open target={target} onClose={() => {}} />, {
      path: `/projects/${KEY}/versions`,
      handlers: [http.post(`${BASE}/versions`, record('POST')), http.patch(`${BASE}/versions/:id`, record('PATCH'))],
    })
    return { ...view, writes }
  }


  const start = () => screen.getByTestId('version-start-input')
  const release = () => screen.getByTestId('version-release-input')

  // 실제 브라우저는 덜 넣은 날짜(badInput)를 폼 기본 검사로 먼저 잡아 submit 을 막고 말풍선을 띄운다 — 그러면 save() 의 안내에 닿지 못한다.
  // jsdom 은 덮어쓴 validity 로 기본 검사를 하지 않아 아래 테스트들이 이것을 잡지 못하므로, 폼이 기본 검사를 끄는지 따로 본다(리뷰 지적).
  test('폼은 브라우저 기본 검사를 끈다(noValidate) — 덜 넣은 날짜가 칸 아래 안내에 닿게', async () => {
    openForm()
    const form = (await screen.findByTestId('version-save')).closest('form')!
    expect(form.noValidate).toBe(true)
  })

  test('만들기 — 출시일을 덜 넣고(change 없음) 저장하면 칸 아래에 안내를 보이고 요청을 보내지 않는다', async () => {
    const { user, writes } = openForm()
    await user.click(await screen.findByTestId('version-name-input'))
    await user.paste('2.0.0')
    setBadInput(release(), true)
    await user.click(screen.getByTestId('version-save'))
    await waitFor(() => expect(document.querySelector('#version-release-error')).toHaveTextContent(MESSAGE))
    expect(release()).toHaveAttribute('aria-invalid', 'true')
    expect(document.querySelector('#version-start-error')).toBeNull()
    await expectNoRequest(writes)
    expect(screen.getByTestId('version-form-dialog')).toBeInTheDocument()
  })

  test('만들기 — 시작일을 덜 넣어도 시작일 칸에 안내를 보이고 요청을 보내지 않는다', async () => {
    const { user, writes } = openForm()
    await user.click(await screen.findByTestId('version-name-input'))
    await user.paste('2.0.0')
    setBadInput(start(), true)
    await user.click(screen.getByTestId('version-save'))
    await waitFor(() => expect(document.querySelector('#version-start-error')).toHaveTextContent(MESSAGE))
    expect(document.querySelector('#version-release-error')).toBeNull()
    await expectNoRequest(writes)
  })

  test('고치기 — 저장된 시작일을 덜 지우고 저장하면 안내를 보이고 PATCH(clearStartDate)를 보내지 않는다', async () => {
    const { user, writes } = openForm(createVersion({ id: 1, name: '1.0.0', startDate: '2026-12-01' }))
    expect(await screen.findByTestId('version-start-input')).toHaveValue('2026-12-01')
    // 저장된 날짜를 지우다 만 칸 — 브라우저는 값을 '' 로 올리고(change) 칸은 덜 넣은 상태(badInput)가 된다.
    // 이 값 그대로면 versionPatch 가 clearStartDate 를 보내 저장된 날짜가 지워지므로, 저장 전에 막아야 한다.
    fireEvent.change(start(), { target: { value: '' } })
    setBadInput(start(), true)
    await user.click(screen.getByTestId('version-save'))
    await waitFor(() => expect(document.querySelector('#version-start-error')).toHaveTextContent(MESSAGE))
    expect(start()).toHaveAttribute('aria-invalid', 'true')
    await expectNoRequest(writes)
  })

  test('고치기 — 칸을 완전히 비우면(덜 넣음 아님) 지금처럼 clearStartDate PATCH 를 보낸다', async () => {
    const { user, writes } = openForm(createVersion({ id: 1, name: '1.0.0', startDate: '2026-12-01' }))
    await screen.findByTestId('version-start-input')
    fireEvent.change(start(), { target: { value: '' } })
    await user.click(screen.getByTestId('version-save'))
    await waitFor(() => expect(writes).toEqual([{ method: 'PATCH', path: `${BASE}/versions/1`, body: { clearStartDate: true } }]))
    expect(document.querySelector('#version-start-error')).toBeNull()
  })

  test('안내대로 덜 넣은 칸을 비우면(change 없음, keyUp) 안내가 사라지고 다시 저장하면 clear PATCH 로 통과한다', async () => {
    const { user, writes } = openForm(createVersion({ id: 1, name: '1.0.0', startDate: '2026-12-01' }))
    await screen.findByTestId('version-start-input')
    fireEvent.change(start(), { target: { value: '' } })
    setBadInput(start(), true)
    await user.click(screen.getByTestId('version-save'))
    await waitFor(() => expect(document.querySelector('#version-start-error')).toHaveTextContent(MESSAGE))

    // 칸을 마저 비웠다 — 값은 이미 '' 였으니 change 없이 keyUp 만 온다.
    setBadInput(start(), false)
    fireEvent.keyUp(start(), { key: 'Backspace' })
    await waitFor(() => expect(document.querySelector('#version-start-error')).toBeNull())
    expect(start()).not.toHaveAttribute('aria-invalid')

    await user.click(screen.getByTestId('version-save'))
    await waitFor(() => expect(writes).toEqual([{ method: 'PATCH', path: `${BASE}/versions/1`, body: { clearStartDate: true } }]))
  })

  test('칸을 벗어날 때(blur)도 더는 덜 넣은 상태가 아니면 안내가 사라진다', async () => {
    const { user } = openForm(createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-12-01' }))
    await screen.findByTestId('version-release-input')
    setBadInput(release(), true)
    await user.click(screen.getByTestId('version-save'))
    await waitFor(() => expect(document.querySelector('#version-release-error')).toHaveTextContent(MESSAGE))

    setBadInput(release(), false)
    fireEvent.blur(release())
    await waitFor(() => expect(document.querySelector('#version-release-error')).toBeNull())
  })

  test('달력에서 날짜를 마저 고르면(change) 안내가 사라진다 — 달력 선택은 keyUp 이 없다', async () => {
    const { user } = openForm(createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-12-01' }))
    await screen.findByTestId('version-release-input')
    setBadInput(release(), true)
    await user.click(screen.getByTestId('version-save'))
    await waitFor(() => expect(document.querySelector('#version-release-error')).toHaveTextContent(MESSAGE))

    setBadInput(release(), false)
    fireEvent.change(release(), { target: { value: '2026-12-24' } })
    await waitFor(() => expect(document.querySelector('#version-release-error')).toBeNull())
  })

  test('여전히 덜 넣은 채 keyUp 하면 안내가 남는다', async () => {
    const { user } = openForm()
    await user.click(await screen.findByTestId('version-name-input'))
    await user.paste('2.0.0')
    setBadInput(start(), true)
    await user.click(screen.getByTestId('version-save'))
    await waitFor(() => expect(document.querySelector('#version-start-error')).toHaveTextContent(MESSAGE))

    fireEvent.keyUp(start(), { key: '1' })
    expect(document.querySelector('#version-start-error')).toHaveTextContent(MESSAGE)
  })

  test('범위 오류(시작일 > 출시일)는 그대로 보이고 덜 넣음 안내와 따로 선다(양성 대조)', async () => {
    openForm(createVersion({ id: 1, name: '1.0.0', startDate: '2026-12-10', releaseDate: '2026-12-01' }))
    expect(await screen.findByTestId('version-date-error')).toHaveTextContent('시작일은 출시일보다 늦을 수 없어요.')
    expect(document.querySelector('#version-start-error')).toBeNull()
    expect(document.querySelector('#version-release-error')).toBeNull()
  })

  test('날짜를 온전히 넣으면(양성 대조) 만들기 POST 에 날짜가 실린다', async () => {
    const { user, writes } = openForm()
    await user.click(await screen.findByTestId('version-name-input'))
    await user.paste('2.0.0')
    fireEvent.change(release(), { target: { value: '2026-12-24' } })
    await user.click(screen.getByTestId('version-save'))
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'POST', path: `${BASE}/versions`, body: { name: '2.0.0', description: null, startDate: null, releaseDate: '2026-12-24' } },
      ]),
    )
  })
})
