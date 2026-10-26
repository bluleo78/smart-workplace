// 프로젝트 설정 멤버 관리 — 표 헤더·역할 한국어, 추가 검색 picker(#31·#734), 제거 확인창(#139·WP-488), 행 hover 클래스(#308),
// MEMBER 읽기 전용(WP-479) — 페이지 테스트(WP-980). 검색 쿼리(kind·search)·POST payload·후보 정렬·비활성 제외·조건부 렌더는
// 브라우저 없이 판정되므로 e2e/pages/projects/member-search.spec.ts 에서 옮겼다.
// 그 spec 에는 설정 화면 배선(@wiring)과 키보드로 제거한 뒤 초점 이동(WP-891, @input)이 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { projectSettingsHandlers, recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { MemberSummary } from '@/types/member'

import { createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'
const MEMBERS_PATH = `/api/v1/projects/${KEY}/members`

const summary = (userId: number, username: string, name: string, kind: 'HUMAN' | 'AGENT', active = true): MemberSummary => ({
  userId, username, name, email: `${username}@x`, title: null, kind, active, membershipRole: 'MEMBER', membershipStatus: 'ACTIVE',
})
const HUMAN1 = summary(101, 'alice', 'Alice', 'HUMAN')
const HUMAN2 = summary(102, 'bob', 'Bob', 'HUMAN')
const AGENT1 = summary(201, 'ai-bot', 'AI Bot', 'AGENT')
// 비활성 사용자 — 후보 목록에서 제외되어야 한다(#734).
const INACTIVE = summary(103, 'ghost', 'Ghost', 'HUMAN', false)

type StubMember = { userId: number; username: string; name: string; role: string }
const ME_OWNER: StubMember = { userId: 1, username: 'me', name: 'Me', role: 'OWNER' }

/** 로그인한 사람(id 1)이 없으면 OWNER 로 넣는다(WP-479: 관리 조작은 OWNER 에게만 보인다). */
const withMeAsOwner = (members: StubMember[]) => (members.some((m) => m.userId === 1) ? members : [ME_OWNER, ...members])

/**
 * 설정 화면 + 사용자 검색. 검색은 백엔드처럼 kind 로 먼저 좁히고(ALL 이면 전체), search 가 비면 전체를 준다(#734).
 * POST·DELETE 는 멤버 목록을 고쳐 재조회에 반영한다.
 */
function openSettings(initial: StubMember[], { personal = false } = {}) {
  const ref = { current: initial }
  const project = createProject({ key: KEY, name: 'WP', type: personal ? 'PERSONAL' : 'TEAM' })
  const view = renderPage(`/projects/${KEY}/settings`, {
    handlers: [
      http.get('/api/v1/members', ({ request }) => {
        const url = new URL(request.url)
        const q = url.searchParams.get('search') ?? ''
        const kind = url.searchParams.get('kind') ?? 'HUMAN'
        const matched = [HUMAN1, HUMAN2, INACTIVE, AGENT1]
          .filter((u) => kind === 'ALL' || u.kind === kind)
          .filter((u) => q.trim().length < 1 || u.username.includes(q) || u.name.toLowerCase().includes(q.toLowerCase()) || (u.email ?? '').includes(q))
        return HttpResponse.json({ content: matched, page: 0, size: 20, totalElements: matched.length, totalPages: 1 })
      }),
      http.post(MEMBERS_PATH, async ({ request }) => {
        const { userId, role } = (await request.json()) as { userId: number; role: string }
        const u = [HUMAN1, HUMAN2, AGENT1].find((x) => x.userId === userId)!
        ref.current = [...ref.current, { userId, username: u.username, name: u.name, role }]
        return HttpResponse.json({}, { status: 201 })
      }),
      http.delete(`${MEMBERS_PATH}/:id`, ({ params }) => {
        ref.current = ref.current.filter((m) => m.userId !== Number(params.id))
        return new HttpResponse(null, { status: 204 })
      }),
      http.get(`${MEMBERS_PATH}/:id/assigned-issue-count`, () => HttpResponse.json({ count: 2 })),
      ...projectSettingsHandlers(project, () => withMeAsOwner(ref.current)),
    ],
  })
  return { ...view, ref }
}

/** 멤버 추가 picker 를 열고 검색어를 넣는다(빈 문자열이면 넣지 않는다). */
async function openPicker(user: ReturnType<typeof renderPage>['user'], query = '') {
  await user.click(await screen.findByTestId('member-add-trigger', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  const popover = await screen.findByTestId('member-search-popover')
  if (query) {
    await user.click(within(popover).getByPlaceholderText('이름·아이디·이메일로 검색'))
    await user.paste(query)
  }
  return popover
}

describe('멤버 표·역할 한국어 (#140·#158)', () => {
  test('역할 드롭다운(추가·행)이 한국어 옵션만 보인다', async () => {
    const { user } = openSettings([ME_OWNER, { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' }])
    // 멤버 추가 역할 선택.
    await screen.findByTestId('member-add-trigger', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await user.click(document.getElementById('new-member-role')!)
    let listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByRole('option', { name: '멤버' })).toBeInTheDocument()
    expect(within(listbox).getByRole('option', { name: '소유자' })).toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: 'MEMBER' })).not.toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: 'OWNER' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())

    // 멤버 목록 행의 역할 변경.
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    await user.click(within(rows[0]).getByRole('combobox'))
    listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByRole('option', { name: '멤버' })).toBeInTheDocument()
    expect(within(listbox).getByRole('option', { name: '소유자' })).toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: 'MEMBER' })).not.toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: 'OWNER' })).not.toBeInTheDocument()
  })

  // #308 — 클릭 가능한 행의 시각 피드백 클래스.
  test('멤버 표 행에 hover 스타일 클래스가 붙는다', async () => {
    openSettings([ME_OWNER, { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' }])
    await screen.findByTestId('member-remove-2', {}, { timeout: PAGE_LOAD_TIMEOUT })
    const firstRow = within(screen.getByRole('table')).getAllByRole('row')[1]
    expect(firstRow).toHaveClass('hover:bg-accent/50', 'transition-colors')
  })
})

describe('멤버 추가 검색 picker', () => {
  test('검색 → 후보 클릭 → POST {userId, role: MEMBER} + 토스트 + 표 갱신', async () => {
    const requests = recordRequests()
    const { user } = openSettings([ME_OWNER])
    const popover = await openPicker(user, 'ali')
    await user.click(await within(popover).findByTestId(`member-search-row-${HUMAN1.userId}`))
    await waitFor(() => expect(requests.bodies('POST', MEMBERS_PATH)).toEqual([{ userId: HUMAN1.userId, role: 'MEMBER' }]))
    expect(await screen.findByText('Alice 을(를) 추가했습니다')).toBeInTheDocument()
    expect(await screen.findByRole('row', { name: /Alice/ })).toBeInTheDocument()
  })

  // 탭 선택은 클라이언트 필터가 아니라 백엔드 kind 를 구동해야 한다(#734) — 첫 페이지에 AGENT 가 없으면 빈 목록이 되므로.
  test('AGENT 필터 → 백엔드 kind=AGENT 조회 + AGENT 만 노출', async () => {
    const requests = recordRequests()
    const { user } = openSettings([])
    const popover = await openPicker(user, 'a')
    // 검색어 'a' 결과(alice·ai-bot)가 올 때까지 — bob 은 빠진다.
    await waitFor(() => {
      expect(within(popover).queryByTestId(`member-search-row-${HUMAN2.userId}`)).not.toBeInTheDocument()
      expect(within(popover).getByTestId(`member-search-row-${HUMAN1.userId}`)).toBeInTheDocument()
    })
    expect(within(popover).getByTestId(`member-search-row-${AGENT1.userId}`)).toBeInTheDocument()
    const agentFilter = within(popover).getByTestId('member-search-filter-AGENT')
    expect(agentFilter).toHaveTextContent('에이전트')
    await user.click(agentFilter)
    await waitFor(() => {
      expect(within(popover).queryByTestId(`member-search-row-${HUMAN1.userId}`)).not.toBeInTheDocument()
      expect(within(popover).getByTestId(`member-search-row-${AGENT1.userId}`)).toBeInTheDocument()
    })
    await waitFor(() =>
      expect(requests.of('GET', '/api/v1/members').some((r) => r.search.get('kind') === 'AGENT' && r.search.get('search') === 'a')).toBe(true),
    )
  })

  test('검색어 없이 열면 kind=ALL 기본 후보 — 비활성 제외, 이미 멤버는 뒤로, 목록 이름은 한국어 (#734·WP-731)', async () => {
    const requests = recordRequests()
    const { user } = openSettings([{ userId: HUMAN1.userId, username: 'alice', name: 'Alice', role: 'MEMBER' }])
    const popover = await openPicker(user)
    expect(await within(popover).findByTestId(`member-search-row-${HUMAN2.userId}`)).toBeInTheDocument()
    expect(within(popover).getByTestId(`member-search-row-${AGENT1.userId}`)).toBeInTheDocument()
    expect(within(popover).queryByTestId(`member-search-row-${INACTIVE.userId}`)).not.toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: '멤버 후보' })).toBeInTheDocument()
    expect(requests.of('GET', '/api/v1/members').some((r) => (r.search.get('search') ?? '') === '' && r.search.get('kind') === 'ALL')).toBe(true)
    const ids = within(popover).getAllByTestId(/^member-search-row-/).map((el) => el.getAttribute('data-testid'))
    expect(ids.at(-1)).toBe(`member-search-row-${HUMAN1.userId}`)
  })

  test('에이전트를 이름으로 검색하면 후보로 노출된다 (#734)', async () => {
    const { user } = openSettings([])
    const popover = await openPicker(user, 'AI Bot')
    // 검색은 디바운스 뒤 다시 묻는다 — 기본 후보(전체)가 검색 결과로 바뀔 때까지 기다린다.
    await waitFor(() => {
      expect(within(popover).queryByTestId(`member-search-row-${HUMAN1.userId}`)).not.toBeInTheDocument()
      expect(within(popover).getByTestId(`member-search-row-${AGENT1.userId}`)).toBeInTheDocument()
    })
  })

  test('이미 멤버인 후보는 (이미 멤버)·disabled 이고 눌러도 POST 가 없다', async () => {
    const requests = recordRequests()
    const { user } = openSettings([{ userId: HUMAN1.userId, username: 'alice', name: 'Alice', role: 'MEMBER' }])
    const popover = await openPicker(user, 'alice')
    const row = await within(popover).findByTestId(`member-search-row-${HUMAN1.userId}`)
    expect(row).toHaveTextContent('(이미 멤버)')
    expect(row).toHaveAttribute('data-disabled', 'true')
    // pointer-events:none 이라 user.click 은 막힌다 — 핸들러가 무동작인지 원시 클릭으로 본다.
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    expect(requests.count('POST', MEMBERS_PATH)).toBe(0)
  })
})

describe('멤버 제거 확인창 (#139·WP-488)', () => {
  test('제거 → 확인창, 취소하면 DELETE 가 없다', async () => {
    const requests = recordRequests()
    const { user } = openSettings([ME_OWNER, { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' }])
    await user.click(await screen.findByTestId('member-remove-2', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('멤버 제거')
    await user.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(requests.count('DELETE', `${MEMBERS_PATH}/2`)).toBe(0)
  })

  test('확인창이 담당 이슈 수를 알리고, 제거를 누르면 DELETE + 토스트', async () => {
    const requests = recordRequests()
    const { user } = openSettings([ME_OWNER, { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' }])
    await user.click(await screen.findByTestId('member-remove-2', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    expect(await screen.findByTestId('delete-impact')).toHaveTextContent('담당 중인 이슈 2개에서 담당자가 해제됩니다.')
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '제거' }))
    await waitFor(() => expect(requests.count('DELETE', `${MEMBERS_PATH}/2`)).toBe(1))
    expect(await screen.findByText('멤버를 제거했습니다')).toBeInTheDocument()
  })
})

// WP-479 — OWNER 가 아닌 MEMBER 에게는 소유자 전용 조작을 보이지 않는다(예전엔 눌러야 403 이 났다).
test('MEMBER 로 연 프로젝트 설정은 소유자 전용 조작을 숨기고 읽기 전용 안내를 보인다', async () => {
  openSettings([
    { userId: 1, username: 'me', name: 'Me', role: 'MEMBER' },
    { userId: 2, username: 'boss', name: 'Boss', role: 'OWNER' },
  ])
  expect(await screen.findByTestId('project-settings-readonly', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(document.getElementById('settings-name')).toBeDisabled()
  expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('member-add-trigger')).not.toBeInTheDocument()
  expect(screen.queryByTestId('member-remove-2')).not.toBeInTheDocument()
  expect(await screen.findByTestId('member-role-2')).toHaveTextContent('소유자')
  expect(screen.queryByTestId('project-delete')).not.toBeInTheDocument()
})
