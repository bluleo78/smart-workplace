// 데스크톱 보드 — 프로젝트 상태 컬럼(WP-808·809·936) — 페이지 테스트(WP-971).
// 상태 색 클래스·범주 띠 ＋/헤더 ⋯ 추가 payload·상태 필터 조회·상태 목록 오류와 다시 시도·20개 상한·유효성/409 오류·
// 컬럼에서 이슈 추가 중 상태가 지워진 경우·역할/개인 프로젝트별 편집 진입점·「완료 모두 보기」는 브라우저 없이 판정되므로
// e2e/pages/projects/board-custom-status.spec.ts 에서 옮겼다. 컬럼 배선(@wiring)·띠 기하(@layout)·포커스 복원·IME·카드 끌기(@input)·
// 설정으로 넘어가는 흐름(@flow)은 E2E 에 남는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { IssueResponse } from '@/types/issue'
import type { ProjectStatus } from '@/types/projectStatus'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'
import { inServerOrder, makeProjectStatus, seedStatuses, withCustomStatuses } from '../../../e2e/factories/projectStatus.factory'

const KEY = 'WP'
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`
const STATUSES_PATH = `/api/v1/projects/${KEY}/statuses`

// 8개 상태 — 할 일(1) · 진행 중(2)·설계(11)·리뷰 대기(12)·배포 대기(13) · 완료(3)·배포 완료(14) · 취소(4).
function boardStatuses(): ProjectStatus[] {
  return [...withCustomStatuses('설계', '리뷰 대기', '배포 대기'), makeProjectStatus({ id: 14, name: '배포 완료', category: 'DONE', position: 7 })]
}

type Options = { role?: 'OWNER' | 'MEMBER'; issues?: IssueResponse[]; statuses?: ProjectStatus[] }

/**
 * 보드 API — 상태 목록은 POST(추가)·PATCH(이름 변경)를 반영해 다음 GET 에 돌려준다.
 * 이슈 검색은 서버처럼 statusId 로 좁히고, 검색 URL 은 searches 에, 상태 추가 본문은 posts 에 쌓는다.
 */
function boardApi({ role = 'OWNER', issues = [], statuses = boardStatuses() }: Options = {}) {
  const searches: URL[] = []
  const posts: unknown[] = []
  const handlers = [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
    http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([createMember({ userId: 1, role })])),
    http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
    http.get(STATUSES_PATH, () => HttpResponse.json(inServerOrder(statuses))),
    http.post(STATUSES_PATH, async ({ request }) => {
      const body = (await request.json()) as { name: string; category: ProjectStatus['category'] }
      posts.push(body)
      const created = makeProjectStatus({ id: 20 + statuses.length, name: body.name, category: body.category, position: 50 })
      statuses.push(created)
      return HttpResponse.json(created, { status: 201 })
    }),
    http.get(ISSUES_PATH, ({ request }) => {
      const url = new URL(request.url)
      searches.push(url)
      const ids = (url.searchParams.get('statusId') ?? '').split(',').filter(Boolean).map(Number)
      return HttpResponse.json(createIssueSearchResponse(issues.filter((i) => ids.length === 0 || ids.includes(i.statusId))))
    }),
  ]
  return { handlers, searches, posts, statuses }
}

/** 보드를 열고 컬럼(기본: 진행 중)이 뜰 때까지 기다린다. extra 핸들러가 boardApi 보다 먼저 받는다. */
async function openBoard(
  api: ReturnType<typeof boardApi>,
  { query = '', extra = [], waitFor: col = 'board-col-2' }: { query?: string; extra?: RequestHandler[]; waitFor?: string } = {},
) {
  const view = renderPage(`/projects/${KEY}?view=board${query}`, { handlers: [...extra, ...api.handlers] })
  await screen.findByTestId(col, {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

/** 인라인 입력에 값을 넣고 Enter — 글자 하나하나는 의미가 없어 change 로 채운다. */
async function submitName(user: ReturnType<typeof renderPage>['user'], value: string) {
  const input = await screen.findByTestId('status-name-input')
  fireEvent.change(input, { target: { value } })
  await user.type(input, '{Enter}')
  return input
}

const REVIEW_ISSUE = createIssue({ id: 1, number: 1, title: '리뷰할 것', statusId: 12, statusName: '리뷰 대기', status: 'IN_PROGRESS' })

describe('보드 — 프로젝트 상태 컬럼', () => {
  test('상태 색이 컬럼 헤더 아이콘에 반영되고, 기본 색은 범주 색 그대로다', async () => {
    // 「리뷰 대기」만 PURPLE — 나머지는 범주 기본 색이라 범주 시맨틱 색을 그대로 쓴다(WP-809).
    const statuses = boardStatuses()
    statuses.find((s) => s.id === 12)!.color = 'PURPLE'
    await openBoard(boardApi({ statuses }))
    // 헤더 아이콘 = 상태 이름 칸(title) 바로 앞 svg. 카드 아이콘과 섞이지 않게 이름 span 의 형제로 좁힌다.
    const headerIcon = (id: number, name: string) =>
      screen.getByTestId(`board-col-${id}`).querySelector(`span:has(> span[title="${name}"]) > svg`)!
    expect(headerIcon(12, '리뷰 대기')).toHaveClass('text-purple-700', 'dark:text-purple-300')
    expect(headerIcon(11, '설계')).toHaveClass('text-primary')
    expect(headerIcon(11, '설계')).not.toHaveClass('text-blue-700')
  })

  test('범주 띠 ＋ 로 진행 중 맨 뒤에 상태를 추가하면 새 컬럼이 생기고 자기 statusId 로 조회한다', async () => {
    const api = boardApi()
    const { user } = await openBoard(api)
    await user.click(screen.getByTestId('board-band-add-IN_PROGRESS'))
    await submitName(user, 'QA 대기')
    await waitFor(() => expect(api.posts).toEqual([{ name: 'QA 대기', category: 'IN_PROGRESS' }]))
    expect(await screen.findByTestId('board-col-28')).toHaveTextContent('QA 대기')
    await waitFor(() => expect(screen.queryByTestId('status-name-input')).not.toBeInTheDocument())
    await waitFor(() => expect(api.searches.some((u) => u.searchParams.get('statusId') === '28')).toBe(true))
  })

  test('「상태」 필터(statusId)로 고른 컬럼만 조회하고, 다른 컬럼은 빈 열로 보인다', async () => {
    const api = boardApi({ issues: [REVIEW_ISSUE] })
    await openBoard(api, { query: '&statusId=12' })
    expect(await within(screen.getByTestId('board-col-12')).findByTestId('issue-card-1')).toBeInTheDocument()
    expect(screen.getByTestId('board-col-empty-2')).toBeInTheDocument()
    expect(api.searches.length).toBeGreaterThan(0)
    expect(api.searches.filter((u) => u.searchParams.get('statusId') !== '12')).toEqual([])
  })

  test('상태 목록을 불러오지 못하면 다시 시도를 보이고 보드를 그리지 않으며, 다시 시도 성공 뒤 보드가 그려진다', async () => {
    const api = boardApi()
    let fail = true
    const { user } = renderPage(`/projects/${KEY}?view=board`, {
      handlers: [
        http.get(STATUSES_PATH, () => (fail ? HttpResponse.json({ status: 500, message: '서버 오류' }, { status: 500 }) : undefined)),
        ...api.handlers,
      ],
    })
    const error = await screen.findByTestId('project-statuses-error', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(error).toHaveTextContent('상태 목록을 불러오지 못했습니다')
    expect(screen.queryByTestId('board-scroll')).not.toBeInTheDocument()
    fail = false
    await user.click(within(error).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('board-col-12')).toBeInTheDocument()
    expect(screen.queryByTestId('project-statuses-error')).not.toBeInTheDocument()
  })

  test('헤더 ⋯ 이 뒤에 상태 추가는 afterStatusId 를 보낸다', async () => {
    const api = boardApi()
    const { user } = await openBoard(api)
    await user.click(screen.getByTestId('board-col-menu-2'))
    await user.click(await screen.findByRole('menuitem', { name: '이 뒤에 상태 추가' }))
    await submitName(user, 'QA 대기')
    await waitFor(() => expect(api.posts).toEqual([{ name: 'QA 대기', category: 'IN_PROGRESS', afterStatusId: 2 }]))
  })

  test('상태가 20개면 헤더 ⋯ 추가와 범주 띠 ＋ 가 막히고 이유를 보인다(이름 변경은 그대로)', async () => {
    const statuses = boardStatuses()
    // 8개 + 진행 중 12개 = 상한 20개.
    for (let i = 0; i < 12; i++) statuses.push(makeProjectStatus({ id: 100 + i, name: `추가 상태 ${i + 1}`, category: 'IN_PROGRESS', position: 20 + i }))
    const api = boardApi({ statuses })
    const { user } = await openBoard(api)
    await user.click(screen.getByTestId('board-col-menu-2'))
    const item = await screen.findByRole('menuitem', { name: /이 뒤에 상태 추가/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    // 이유는 흐려지는 항목 밖에 또렷하게 두고 aria-describedby 로 잇는다(WP-809 디자이너 리뷰).
    const reason = screen.getByTestId('board-col-add-after-reason')
    expect(reason).toHaveTextContent('상태는 프로젝트당 20개까지예요')
    expect(item).toHaveAttribute('aria-describedby', reason.id)
    expect(screen.getByRole('menuitem', { name: '이름 변경' })).not.toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Escape}')
    for (const category of ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']) {
      expect(screen.getByTestId(`board-band-add-${category}`)).toBeDisabled()
    }
    // 감싼 칸에 포커스하면 같은 이유가 툴팁으로 뜬다.
    fireEvent.focus(screen.getByTestId('board-band-add-limit-TODO'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('상태는 프로젝트당 20개까지예요')
    expect(api.posts).toEqual([])
  })

  test('서버가 중복 이름(409)으로 거절하면 그 자리에 오류를 보이고 입력을 남긴다', async () => {
    const api = boardApi()
    const { user } = await openBoard(api, {
      extra: [http.post(STATUSES_PATH, () => HttpResponse.json({ status: 409, message: '이미 존재하는 상태 이름입니다: 검토 중' }, { status: 409 }))],
    })
    await user.click(screen.getByTestId('board-band-add-IN_PROGRESS'))
    const input = await submitName(user, '검토 중')
    // 서버 409 는 클라이언트 중복 검사와 같은 문구로 보인다.
    expect(await screen.findByTestId('status-name-error')).toHaveTextContent(/^이미 존재하는 상태 이름입니다$/)
    expect(input).toHaveValue('검토 중')
  })

  test('31자 이름은 저장하지 않고 오류를 보인다', async () => {
    const api = boardApi()
    const { user } = await openBoard(api)
    await user.click(screen.getByTestId('board-band-add-TODO'))
    await submitName(user, '가'.repeat(31))
    expect(await screen.findByTestId('status-name-error')).toHaveTextContent('상태 이름은 30자 이하로 입력해 주세요')
    expect(api.posts).toEqual([])
  })

  test('MEMBER 에게는 범주 띠는 보이지만 ＋와 ⋯ 편집 항목이 없다', async () => {
    const { container } = await openBoard(boardApi({ role: 'MEMBER' }))
    expect(screen.getByTestId('board-band-IN_PROGRESS')).toBeInTheDocument()
    expect(container.ownerDocument.querySelectorAll('[data-testid^="board-band-add-"]')).toHaveLength(0)
    expect(container.ownerDocument.querySelectorAll('[data-testid^="board-col-menu-"]')).toHaveLength(0)
  })

  test('개인 프로젝트 보드는 3컬럼(취소 없음)이고 범주 띠·편집 진입점이 없다', async () => {
    const api = boardApi({ statuses: seedStatuses() })
    const { container } = await openBoard(api, {
      waitFor: 'board-col-1',
      extra: [http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ type: 'PERSONAL', isDefault: true })))],
    })
    const doc = container.ownerDocument
    await waitFor(() => expect([...doc.querySelectorAll('[data-testid^="board-col-"][data-status-id]')].map((e) => e.getAttribute('data-status-id'))).toEqual(['1', '2', '3']))
    expect(doc.querySelectorAll('[data-testid^="board-band-"]')).toHaveLength(0)
    expect(doc.querySelectorAll('[data-testid^="board-col-menu-"]')).toHaveLength(0)
  })

  test('완료 범주의 모든 컬럼(완료·배포 완료·취소)에만 「완료 모두 보기」 안내가 붙는다', async () => {
    await openBoard(boardApi())
    for (const id of [3, 14, 4]) expect(screen.getByTestId(`board-col-show-closed-${id}`)).toBeInTheDocument()
    for (const id of [1, 12]) expect(screen.queryByTestId(`board-col-show-closed-${id}`)).not.toBeInTheDocument()
  })
})

// 409 STATUS_DELETED(확인 뒤 삭제 경합)·400 STATUS_NOT_FOUND(요청 전에 이미 삭제) 둘 다 같은 흐름이다(WP-936).
// 다이얼로그엔 상태 고르기가 없으므로 서버 문구 대신 다시 만들면 무엇이 되는지 알리고, 다음 생성은 statusId 없이 보낸다.
describe.each([
  { status: 409, code: 'STATUS_DELETED', message: '상태가 방금 삭제됐어요. 다른 상태를 골라 주세요.' },
  { status: 400, code: 'STATUS_NOT_FOUND', message: '상태를 찾을 수 없어요. 다른 상태를 골라 주세요.' },
])('컬럼에서 이슈 추가 — 컬럼 상태가 없어짐($status $code)', (gone) => {
  test('결과 안내를 보이고 상태 목록을 다시 받아 컬럼을 지우며, 다시 누르면 statusId 없이 만든다', async () => {
    const api = boardApi()
    const posted: Record<string, unknown>[] = []
    let statusGets = 0
    const { user } = await openBoard(api, {
      waitFor: 'board-col-12',
      extra: [
        http.get(STATUSES_PATH, () => {
          statusGets++
          return undefined
        }),
        http.post(ISSUES_PATH, async ({ request }) => {
          posted.push((await request.json()) as Record<string, unknown>)
          if (posted.length === 1) {
            // 다른 사람이 「리뷰 대기」(12)를 막 지운 상황 — 이후 상태 목록에서 빠진다.
            api.statuses.splice(api.statuses.findIndex((s) => s.id === 12), 1)
            return HttpResponse.json({ status: gone.status, message: gone.message, errors: { code: gone.code } }, { status: gone.status })
          }
          return HttpResponse.json(createIssue({ id: 9, number: 9, title: '새 이슈', status: 'TODO' }), { status: 201 })
        }),
      ],
    })
    const before = statusGets
    await user.click(screen.getByTestId('board-col-add-12'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('create-status-note')).toHaveTextContent('상태: 리뷰 대기')
    fireEvent.change(dialog.querySelector('#issue-title')!, { target: { value: '지워진 상태에서 연 이슈' } })
    await user.click(within(dialog).getByRole('button', { name: '생성' }))

    expect(await screen.findByText("상태가 방금 삭제됐어요. 다시 만들면 '할 일'로 만들어져요.")).toBeInTheDocument()
    expect(screen.queryByText(gone.message)).not.toBeInTheDocument()
    await waitFor(() => expect(statusGets).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByTestId('board-col-12')).not.toBeInTheDocument())
    expect(posted[0]?.statusId).toBe(12)
    // 다이얼로그는 입력을 지닌 채 남고, 지워진 상태 안내는 사라진다.
    expect(within(dialog).queryByTestId('create-status-note')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]?.statusId).toBeUndefined()
    expect(posted[1]?.title).toBe('지워진 상태에서 연 이슈')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
