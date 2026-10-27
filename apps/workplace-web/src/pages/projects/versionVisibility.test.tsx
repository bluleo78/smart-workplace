// 버전 노출 조건(WP-888) — 페이지 테스트(WP-971).
// 보관 안 된 버전이 없으면 이슈 상세·목록 필터·열 고르기·타임라인 레인에 버전이 없고(있으면 나타나고),
// 보관 버전은 필터의 「보관됨」 묶음에 놓이는 것은 조건부 렌더라 브라우저 없이 판정되므로 e2e/pages/issue-versions.spec.ts 에서 옮겼다.
// 「없다」 단언은 데이터가 오기 전에도 참이라, 버전 응답이 나간 뒤 같은 화면의 양성 기준점을 확인하고 판정한다.
// 숨김·노출은 같은 판정 함수(expectVersionVisibility)를 써서 숨김 단언이 선택자 오타로 거짓 통과하지 않게 한다.
// 이슈 상세·프로젝트 목록·타임라인 화면을 각각 renderScreen 으로 띄운다 — 앱 셸·인증 부팅은 건너뛴다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import IssueDetailPage from '@/pages/projects/IssueDetailPage'
import ProjectDetailPage from '@/pages/projects/ProjectDetailPage'
import TimelinePage from '@/pages/projects/timeline/TimelinePage'
import { atRoute } from '@/test/kits/projects/atRoute'
import { openQuickFacet } from '@/test/kits/projects/quickFilter'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { BASE, KEY, versionApi, type VersionApiOptions } from '@/test/msw/versionHandlers'
import { renderScreen } from '@/test/renderScreen'

import { createVersion, toVersionSummary } from '../../../e2e/factories/version.factory'

/** 프로젝트 목록 화면만 띄운다 — 화면이 부르는 부가 조회는 shellHandlers 의 빈 기본값이 받는다. */
const renderList = (api: ReturnType<typeof versionApi>) =>
  renderScreen(atRoute('/projects/:key', <ProjectDetailPage />), {
    path: `/projects/${KEY}?group=none`,
    handlers: [...api.handlers, ...shellHandlers],
  })

/** 버전 응답이 실제로 나갔는지 기다린다 — 그 전의 「없음」 은 의미가 없다. */
async function versionsServed(api: ReturnType<typeof versionApi>) {
  await waitFor(() => expect(api.served.versions).toBe(true))
}

/** 이슈 상세 — 수정·영향 버전 두 줄. 같은 속성 레일의 담당자 칸이 그려진 뒤에 본다. */
async function expectDetailVisibility(opts: VersionApiOptions, shown: boolean) {
  const api = versionApi(opts)
  // 이슈 상세는 AI 패널 모드(useAssistant)를 읽는다 — AppLayout 과 같은 Provider 로 감싼다.
  const detail = (
    <AIAssistantProvider hotkeysEnabled={false}>
      <IssueDetailPage />
    </AIAssistantProvider>
  )
  const view = renderScreen(atRoute('/projects/:key/issues/:number', detail), {
    path: `/projects/${KEY}/issues/1`,
    handlers: [...api.handlers, ...shellHandlers],
  })
  await screen.findByTestId('property-group-status-people')
  await versionsServed(api)
  if (shown) {
    expect(await screen.findByTestId('issue-fix-versions-field')).toBeInTheDocument()
    expect(screen.getByTestId('issue-affects-versions-field')).toBeInTheDocument()
  } else {
    expect(screen.queryByTestId('issue-fix-versions-field')).not.toBeInTheDocument()
    expect(screen.queryByTestId('issue-affects-versions-field')).not.toBeInTheDocument()
  }
  view.unmount()
}

/** 목록 — 필터 후보·열 후보·머리 링크. 머리의 「버전」 링크는 버전이 없어도 늘 보인다(만들 곳이 있어야 한다). */
async function expectListVisibility(opts: VersionApiOptions, shown: boolean) {
  const api = versionApi(opts)
  const { user } = renderList(api)
  await screen.findByTestId('issue-row-1')
  await versionsServed(api)
  expect(screen.getByRole('link', { name: '버전' })).toBeInTheDocument()

  // 버전 facet 은 「더 보기」 소속(WP-1020) — 있으면 목록에 보이고, 없으면 빠진다.
  await user.click(screen.getByTestId('quick-filter-more'))
  await screen.findByTestId('quick-filter-more-facet-status')
  for (const id of ['quick-filter-more-facet-fixVersion', 'quick-filter-more-facet-affectsVersion']) {
    if (shown) expect(screen.getByTestId(id)).toBeInTheDocument()
    else expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  }
  await user.keyboard('{Escape}')

  await user.click(screen.getByTestId('issue-column-picker'))
  await screen.findByTestId('issue-column-option-assignee')
  for (const id of ['issue-column-option-fixVersions', 'issue-column-option-affectsVersions']) {
    if (shown) expect(screen.getByTestId(id)).toBeInTheDocument()
    else expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  }
}

describe('버전 노출 — 이슈 상세·목록', () => {
  test.each([
    ['버전이 하나도 없으면', []],
    // 보관된 버전만 있는 프로젝트도 「버전을 안 쓰는」 것과 같다(이 이슈에 붙은 것이 없을 때).
    ['보관된 버전만 있으면', [createVersion({ id: 9, name: '옛 버전', status: 'ARCHIVED' })]],
  ])('%s 상세 두 줄·필터 후보·열 후보에 버전이 없지만 머리의 「버전」 링크는 있다', async (_, versions) => {
    await expectDetailVisibility({ versions }, false)
    await expectListVisibility({ versions }, false)
  })

  test('보관 안 된 버전이 있으면 같은 자리(상세 두 줄·필터 후보·열 후보)에 버전이 나타난다', async () => {
    const opts = { versions: [createVersion({ id: 1, name: '1.0.0' })] }
    await expectDetailVisibility(opts, true)
    await expectListVisibility(opts, true)
  })

  test('필터의 수정 버전 후보는 사용 중 값 뒤에 「보관됨」 머리글을 두고 그 아래에 보관 버전을 놓는다', async () => {
    const active = createVersion({ id: 1, name: '1.0.0' })
    const attachedArchived = createVersion({ id: 2, name: '옛 버전', status: 'ARCHIVED' })
    const otherArchived = createVersion({ id: 3, name: '폐기 버전', status: 'ARCHIVED' })
    const api = versionApi({
      versions: [active, attachedArchived, otherArchived],
      issue: { fixVersions: [toVersionSummary(attachedArchived)], affectsVersions: [] },
    })
    const { user } = renderList(api)
    await screen.findByTestId('issue-row-1')
    await openQuickFacet(user, 'fixVersion')
    await screen.findByTestId('facet-group-fixVersion-보관됨')

    // 문서 순서 — 사용 중 값 → 보관됨 머리글 → 보관 버전 둘(붙은 것·안 붙은 것 모두).
    const order = Array.from(
      document.querySelectorAll('[data-testid^="facet-value-fixVersion-"], [data-testid="facet-group-fixVersion-보관됨"]'),
    )
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => id !== 'facet-value-fixVersion-none')
    expect(order).toEqual([
      'facet-value-fixVersion-1',
      'facet-group-fixVersion-보관됨',
      'facet-value-fixVersion-2',
      'facet-value-fixVersion-3',
    ])
  })
})

describe('버전 노출 — 타임라인 레인', () => {
  // 간트(SVAR)가 격자 배경을 캔버스로 그린다 — jsdom 은 캔버스가 없어 getContext 가 null 이라 간트가 깨진다.
  // 그리기 결과(배경 이미지)는 이 테스트의 관심사가 아니라 빈 2D 컨텍스트로 보강한다(기하는 E2E 몫).
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({ translate() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeStyle: '' }) as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** 간트가 그려질 이슈 한 건과 함께 타임라인을 연다. 날짜만 고정한다(타이머까지 가짜로 두면 MSW·userEvent 가 멈춘다). */
  async function openTimeline(opts: VersionApiOptions) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-08T03:00:00Z'))
    const api = versionApi({ ...opts, issue: { startDate: '2026-07-01', dueDate: '2026-07-14' } })
    renderScreen(atRoute('/projects/:key/timeline', <TimelinePage />), {
      path: `/projects/${KEY}/timeline?period=all`,
      handlers: [http.get(`${BASE}/issue-dependencies`, () => HttpResponse.json([])), ...api.handlers, ...shellHandlers],
    })
    await screen.findByTestId('timeline-gantt')
    await versionsServed(api)
    return api
  }

  test('출시일이 있는 보관 안 된 버전만 레인에 칩으로 그린다 — 보관·출시일 없음은 빠진다', async () => {
    await openTimeline({
      versions: [
        createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-07-10' }),
        createVersion({ id: 2, name: '옛 버전', releaseDate: '2026-07-12', status: 'ARCHIVED' }),
        createVersion({ id: 3, name: '날짜 미정' }),
      ],
    })
    const lane = await screen.findByTestId('version-lane')
    expect(within(lane).getByTestId('version-chip-1')).toHaveTextContent('1.0.0')
    expect(within(lane).queryByTestId('version-chip-2')).not.toBeInTheDocument()
    expect(within(lane).queryByTestId('version-chip-3')).not.toBeInTheDocument()
  })

  test('버전이 없으면 간트는 그려도 버전 레인은 없다', async () => {
    await openTimeline({ versions: [] })
    // 간트 본문(오늘 선)이 그려진 뒤여야 「레인 없음」 이 의미가 있다.
    expect(await screen.findByTestId('timeline-today-line')).toBeInTheDocument()
    expect(screen.queryByTestId('version-lane')).not.toBeInTheDocument()
  })
})
