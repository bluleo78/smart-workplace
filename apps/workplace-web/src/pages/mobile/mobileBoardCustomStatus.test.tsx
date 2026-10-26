// 모바일 보드 — 프로젝트 상태 탭·현재 탭 ⋯ 바텀시트(WP-808·WP-809) — 페이지 테스트(WP-981).
// 빈 탭 「이슈 추가」의 statusId, 상태 20개 상한 비활성, 이 뒤에 상태 추가·이름 변경의 유효성·payload·새 탭 선택,
// 409 오류 문구, 「상태 관리…」 이동, MEMBER 의 편집 항목 숨김, statusId 필터 탭은 브라우저 없이 판정되므로
// e2e/pages/mobile/board-custom-status.spec.ts 에서 옮겼다. 탭 띠 색(계산 스타일)·터치 크기·넘침·탭 스크롤(@layout)과
// 보드 배선(@wiring)은 E2E 에 남는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'
import type { IssueResponse } from '@/types/issue'
import type { ProjectStatus } from '@/types/projectStatus'

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'
import { inServerOrder, makeProjectStatus, withCustomStatuses } from '../../../e2e/factories/projectStatus.factory'

// 휴대폰 폭·터치 포인터 — 보드가 모바일 탭 보기로 그려지게 한다.
mockViewport()

// jsdom 은 요소의 scrollTo 가 없다 — 탭 줄이 선택 탭을 보이게 스크롤하는 호출(스크롤 위치는 E2E @layout 의 관심사)을 빈 구현으로 받는다.
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}

const KEY = 'WP'
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`
const STATUSES_PATH = `/api/v1/projects/${KEY}/statuses`

// 8개 상태 — 할 일(1) · 진행 중(2)·설계(11)·리뷰 대기(12)·배포 대기(13) · 완료(3)·배포 완료(14) · 취소(4).
function boardStatuses(): ProjectStatus[] {
  return [
    ...withCustomStatuses('설계', '리뷰 대기', '배포 대기'),
    makeProjectStatus({ id: 14, name: '배포 완료', category: 'DONE', position: 7 }),
  ]
}

const PROG = createIssue({ id: 1, number: 1, projectKey: KEY, title: '진행 중인 일', statusId: 2, statusName: '진행 중', status: 'IN_PROGRESS' })
const REVIEW = createIssue({ id: 2, number: 2, projectKey: KEY, title: '리뷰할 것', statusId: 12, statusName: '리뷰 대기', status: 'IN_PROGRESS' })

type Writes = { issuePosts: unknown[]; statusPosts: unknown[]; statusPatches: { id: number; body: unknown }[] }

/**
 * 보드 API — 상태 목록은 POST(추가)·PATCH(이름 변경)를 반영해 다음 GET 에 돌려준다(서버처럼).
 * 이슈 검색은 statusId 쿼리로 좁힌다. 쓰기 요청 본문은 writes 에 모은다.
 */
function boardApi({
  role = 'OWNER',
  statuses = boardStatuses(),
  issues = [PROG, REVIEW],
  statusPost,
}: {
  role?: 'OWNER' | 'MEMBER'
  statuses?: ProjectStatus[]
  issues?: IssueResponse[]
  /** 상태 추가 응답을 바꿀 때(409 등). */
  statusPost?: () => Response
} = {}) {
  const writes: Writes = { issuePosts: [], statusPosts: [], statusPatches: [] }
  const handlers = [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))),
    http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([createMember({ userId: 1, role })])),
    http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
    // 설정 화면(「상태 관리…」 이동 뒤)이 부르는 조회.
    http.get(`/api/v1/projects/${KEY}/fields`, () => HttpResponse.json([])),
    http.get(`${ISSUES_PATH}/group-counts`, () => HttpResponse.json({ groupBy: 'statusId', groups: [] })),
    http.get(STATUSES_PATH, () => HttpResponse.json(inServerOrder(statuses))),
    http.post(STATUSES_PATH, async ({ request }) => {
      const body = (await request.json()) as { name: string; category: ProjectStatus['category'] }
      writes.statusPosts.push(body)
      if (statusPost) return statusPost()
      const created = makeProjectStatus({ id: 20 + statuses.length, name: body.name, category: body.category, position: 50 })
      statuses.push(created)
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch(`${STATUSES_PATH}/:id`, async ({ request, params }) => {
      const body = (await request.json()) as { name: string }
      writes.statusPatches.push({ id: Number(params.id), body })
      const s = statuses.find((x) => x.id === Number(params.id))!
      s.name = body.name
      return HttpResponse.json(s)
    }),
    http.get(ISSUES_PATH, ({ request }) => {
      const ids = (new URL(request.url).searchParams.get('statusId') ?? '').split(',').filter(Boolean).map(Number)
      return HttpResponse.json(createIssueSearchResponse(issues.filter((i) => ids.length === 0 || ids.includes(i.statusId))))
    }),
    http.post(ISSUES_PATH, async ({ request }) => {
      writes.issuePosts.push(await request.json())
      return HttpResponse.json(createIssueDetail({ summary: createIssue({ id: 99, number: 99, projectKey: KEY }) }), { status: 201 })
    }),
  ]
  return { handlers, writes, statuses }
}

/** 보드를 query 로 열고 탭 줄이 뜰 때까지 기다린다. */
async function open(query: string, opts: Parameters<typeof boardApi>[0] = {}) {
  const api = boardApi(opts)
  const view = renderPage(`/projects/${KEY}?view=board&group=none${query}`, { handlers: api.handlers })
  await screen.findByTestId('board-tabs', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return { ...view, ...api }
}

/** 탭 줄 안 role=tab 의 statusId 순서. */
function tabIds() {
  return within(screen.getByTestId('board-tabs'))
    .getAllByRole('tab')
    .map((e) => Number(e.getAttribute('data-testid')!.replace('board-tab-', '')))
}

/** 현재 탭 ⋯ 시트를 열고 항목을 누른다. */
async function openTabMenuItem(user: ReturnType<typeof renderPage>['user'], item: string) {
  await user.click(await screen.findByTestId('board-tab-menu'))
  await user.click(await screen.findByTestId(item))
}

describe('모바일 보드 — 상태 탭 동작', () => {
  // 빈 탭의 「이슈 추가」는 그 탭 상태(statusId)로 만든다 — 엉뚱한 기본 상태로 만들면 방금 만든 이슈가 탭에서 사라진다.
  test('빈 탭의 「이슈 추가」는 그 탭 상태로 만든다', async () => {
    const { user, writes } = await open('&boardTab=13')
    await user.click(await screen.findByTestId('board-col-add-13'))
    fireEvent.change(await screen.findByTestId('issue-create-title'), { target: { value: '배포 체크리스트' } })
    await user.click(screen.getByTestId('issue-create-submit'))
    await waitFor(() => expect(writes.issuePosts).toHaveLength(1))
    expect(writes.issuePosts[0]).toMatchObject({ statusId: 13 })
  })

  // 프로젝트당 상태 20개 상한 — 항목은 비활성이고 이유 문구를 함께 보인다.
  test('상태가 20개면 ⋯ 바텀시트의 이 뒤에 상태 추가가 막히고 이유를 보인다', async () => {
    const extra = Array.from({ length: 12 }, (_, i) =>
      makeProjectStatus({ id: 100 + i, name: `추가 상태 ${i + 1}`, category: 'IN_PROGRESS', position: 20 + i }),
    )
    const { user } = await open('&boardTab=12', { statuses: [...boardStatuses(), ...extra] })
    await user.click(await screen.findByTestId('board-tab-menu'))
    const item = await screen.findByTestId('mobile-action-status-add-after')
    expect(item).toBeDisabled()
    expect(item).toHaveTextContent('상태는 프로젝트당 20개까지예요')
  })

  // 추가 — 시트 문구(현재 상태·범주), 30자 초과 오류는 요청 없이, 정상 이름은 { name, category, afterStatusId } 로 보내고
  // 상태 목록 재조회 뒤 새 탭이 선택되며 URL·헤더에 반영된다(기본 탭 고정이 되돌리지 않음).
  test('⋯ 바텀시트로 이 뒤에 상태를 추가한다 — 30자 초과는 막고, 추가하면 새 탭이 선택된다', async () => {
    const { user, writes, statuses, location } = await open('&boardTab=12')
    await user.click(await screen.findByTestId('board-tab-menu'))
    const sheet = await screen.findByTestId('mobile-status-sheet')
    expect(sheet).toHaveTextContent('리뷰 대기')
    expect(sheet).toHaveTextContent('진행 중')
    await user.click(within(sheet).getByTestId('mobile-action-status-add-after'))

    const nameSheet = await screen.findByTestId('mobile-status-name-sheet')
    expect(nameSheet).toHaveTextContent('범주 진행 중')
    const input = within(nameSheet).getByTestId('status-name-input')
    fireEvent.change(input, { target: { value: '가'.repeat(31) } })
    await user.click(within(nameSheet).getByTestId('status-name-submit'))
    expect(await within(nameSheet).findByTestId('status-name-error')).toHaveTextContent('30자')
    expect(writes.statusPosts).toHaveLength(0)

    fireEvent.change(input, { target: { value: 'QA 대기' } })
    await user.click(within(nameSheet).getByTestId('status-name-submit'))
    await waitFor(() => expect(writes.statusPosts).toEqual([{ name: 'QA 대기', category: 'IN_PROGRESS', afterStatusId: 12 }]))
    await waitFor(() => expect(screen.queryByTestId('mobile-status-name-sheet')).not.toBeInTheDocument())
    const created = statuses.find((x) => x.name === 'QA 대기')!
    const newTab = await screen.findByTestId(`board-tab-${created.id}`)
    expect(newTab).toHaveTextContent('QA 대기')
    await waitFor(() => expect(newTab).toHaveAttribute('aria-selected', 'true'))
    expect(location()).toMatch(new RegExp(`boardTab=${created.id}(&|$)`))
    expect(screen.getByTestId('board-tab-header')).toHaveTextContent('QA 대기')
  })

  // WP-809 — 시트의 「상태 관리…」는 설정 「상태」 섹션으로 간다.
  test('상태 시트의 상태 관리… 는 설정으로 간다', async () => {
    const { user, location } = await open('&boardTab=12', {})
    await openTabMenuItem(user, 'mobile-action-status-manage')
    // 설정 「상태」 섹션 행이 뜨는지까지 본다(주소의 #statuses 해시는 location() 에 없다).
    expect(await screen.findByTestId('status-row-12', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('리뷰 대기')
    expect(location()).toBe(`/projects/${KEY}/settings`)
    expect(screen.getByTestId('settings-statuses')).toBeInTheDocument()
  })

  // 이름 변경 — 다른 상태와 같은 이름(대소문자·공백 무시)은 요청 없이 그 자리 오류, 정상 이름은 PATCH { name } 뒤 탭·헤더 갱신.
  test('⋯ 바텀시트로 이름을 바꾼다 — 중복 이름은 막는다', async () => {
    const { user, writes } = await open('&boardTab=12')
    await openTabMenuItem(user, 'mobile-action-status-rename')
    const nameSheet = await screen.findByTestId('mobile-status-name-sheet')
    const input = within(nameSheet).getByTestId('status-name-input')
    expect(input).toHaveValue('리뷰 대기')

    fireEvent.change(input, { target: { value: ' 설계 ' } })
    await user.click(within(nameSheet).getByTestId('status-name-submit'))
    expect(await within(nameSheet).findByTestId('status-name-error')).toHaveTextContent('이미 존재하는 상태 이름입니다')
    expect(writes.statusPatches).toHaveLength(0)

    fireEvent.change(input, { target: { value: '코드 리뷰' } })
    await user.click(within(nameSheet).getByTestId('status-name-submit'))
    await waitFor(() => expect(writes.statusPatches).toEqual([{ id: 12, body: { name: '코드 리뷰' } }]))
    await waitFor(() => expect(screen.queryByTestId('mobile-status-name-sheet')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('board-tab-12')).toHaveTextContent('코드 리뷰'))
    expect(screen.getByTestId('board-tab-header')).toHaveTextContent('코드 리뷰')
  })

  // 서버 409 는 클라이언트 중복 문구로 시트 안에 보이고 입력은 그대로 남는다(다시 고쳐 보낼 수 있게).
  test('서버가 거절하면(409) 오류를 시트 안에 보이고 입력을 유지한다', async () => {
    const { user } = await open('&boardTab=2', {
      statusPost: () => HttpResponse.json({ status: 409, message: '이미 존재하는 상태 이름입니다: 동시 추가' }, { status: 409 }),
    })
    await openTabMenuItem(user, 'mobile-action-status-add-after')
    const nameSheet = await screen.findByTestId('mobile-status-name-sheet')
    fireEvent.change(within(nameSheet).getByTestId('status-name-input'), { target: { value: '동시 추가' } })
    await user.click(within(nameSheet).getByTestId('status-name-submit'))
    expect(await within(nameSheet).findByTestId('status-name-error')).toHaveTextContent(/^이미 존재하는 상태 이름입니다$/)
    expect(within(nameSheet).getByTestId('status-name-input')).toHaveValue('동시 추가')
  })

  // MEMBER 는 상태 편집 권한이 없어 ⋯ 자체가 없다(헤더 줄의 긴 이름 표시 기하는 E2E @layout).
  test('MEMBER 는 ⋯ 편집 항목이 없고 헤더 줄에 이름 전체가 있다', async () => {
    const long = '고객사 보안 검토 및 법무 승인 대기 중인 배포 후보군'
    const statuses = [...withCustomStatuses(long), makeProjectStatus({ id: 14, name: '배포 완료', category: 'DONE', position: 5 })]
    await open('&boardTab=11', { role: 'MEMBER', statuses })
    await waitFor(() => expect(screen.getByTestId('board-tab-11')).toHaveAttribute('aria-selected', 'true'))
    // 멤버 목록(역할)을 받은 뒤에 판정되도록 헤더가 그려진 다음 본다.
    expect(within(await screen.findByTestId('board-tab-header')).getByTitle(long)).toHaveTextContent(long)
    expect(screen.queryByTestId('board-tab-menu')).not.toBeInTheDocument()
  })

  // 「상태」 필터(statusId)로 고른 상태 탭만 보이고, 진행 중(2)이 숨으면 진행 중 범주의 보이는 첫 상태가 기본 탭.
  test('「상태」 필터(statusId)로 고른 상태 탭만 보인다', async () => {
    await open('&statusId=12,3')
    await waitFor(() => expect(tabIds()).toEqual([12, 3]))
    await waitFor(() => expect(screen.getByTestId('board-tab-12')).toHaveAttribute('aria-selected', 'true'))
  })
})
