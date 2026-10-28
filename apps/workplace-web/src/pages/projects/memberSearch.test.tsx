// 프로젝트 설정 멤버 관리 — 표 헤더·역할 한국어, 추가 선택 창(#31·#734 → WP-1057 사람·조직 공통 창), 제거 확인창(#139·WP-488), 행 hover 클래스(#308),
// MEMBER 읽기 전용(WP-479) — 화면 테스트(WP-980, WP-1002 에서 멤버 섹션만 띄우게 바꿈). 검색 쿼리(kind·search)·POST payload·후보 정렬·비활성 제외·조건부 렌더는
// 브라우저 없이 판정되므로 e2e/pages/projects/member-search.spec.ts 에서 옮겼다.
// 그 spec 에는 설정 화면 배선(@wiring)과 키보드로 제거한 뒤 초점 이동(WP-891, @input)이 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { MemberManagement } from '@/pages/projects/components/MemberManagement'
import ProjectSettingsPage from '@/pages/projects/ProjectSettingsPage'
import { projectSettingsHandlers, recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { shellHandlers } from '@/test/msw/baseHandlers'
import type { ScreenUser } from '@/test/renderScreen'
import { renderScreen } from '@/test/renderScreen'
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
 * 설정 화면 API + 사용자 검색. 검색은 백엔드처럼 kind 로 먼저 좁히고(ALL 이면 전체), search 가 비면 전체를 준다(#734).
 * POST·DELETE 는 멤버 목록을 고쳐 재조회에 반영한다.
 */
function settingsApi(initial: StubMember[], { personal = false } = {}) {
  const ref = { current: initial }
  const project = createProject({ key: KEY, name: 'WP', type: personal ? 'PERSONAL' : 'TEAM' })
  const handlers = [
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
      return HttpResponse.json({ userId, username: u.username, name: u.name, kind: u.kind, role, createdAt: null, active: true, direct: true }, { status: 201 })
    }),
    http.delete(`${MEMBERS_PATH}/:id`, ({ params }) => {
      ref.current = ref.current.filter((m) => m.userId !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    // 사람·조직 선택 창이 열릴 때 받는 그룹 트리(WP-1057) — 이 파일은 사람만 보므로 비운다.
    http.get('/api/v1/user-groups', () => HttpResponse.json({ shared: [], personal: [] })),
    http.get(`${MEMBERS_PATH}/:id/assigned-issue-count`, () => HttpResponse.json({ count: 2 })),
    ...projectSettingsHandlers(project, () => withMeAsOwner(ref.current)),
  ]
  return { handlers, ref }
}

/** 설정의 「멤버」 섹션(MemberManagement)만 띄운다 — 보는 사람은 OWNER(설정 화면이 canManage 로 넘기는 값). */
function openSettings(initial: StubMember[]) {
  const api = settingsApi(initial)
  const view = renderScreen(<MemberManagement projectKey={KEY} canManage />, { path: `/projects/${KEY}/settings`, handlers: api.handlers })
  return { ...view, ref: api.ref }
}

/** 설정 화면 전체를 띄운다 — 멤버 섹션 밖(이름·저장·프로젝트 삭제·읽기 전용 안내)의 권한 분기를 볼 때. */
function openSettingsPage(initial: StubMember[]) {
  const api = settingsApi(initial)
  return renderScreen(
    <Routes>
      <Route path="/projects/:key/settings" element={<ProjectSettingsPage />} />
    </Routes>,
    { path: `/projects/${KEY}/settings`, handlers: [...api.handlers, ...shellHandlers] },
  )
}

/**
 * 멤버 추가 창(사람·조직 공통 선택 창, WP-1057)을 열고 검색어를 넣는다(빈 문자열이면 넣지 않는다). 창(팝오버)을 돌려준다.
 * 팀 프로젝트는 사람·AI·조직도 부서·내 그룹을 한 창에서 고른다 — 부서 쪽 판정은 components/MemberManagementDepartments.test.tsx 가 본다.
 */
async function openPicker(user: ScreenUser, query = '') {
  await user.click(await screen.findByTestId('member-add-trigger'))
  const input = await screen.findByLabelText('사람·팀 검색')
  if (query) {
    await user.click(input)
    await user.paste(query)
  }
  return screen.getByTestId('project-member-picker-search')
}

describe('멤버 표·역할 한국어 (#140·#158)', () => {
  test('역할 드롭다운(추가·행)이 한국어 옵션만 보인다', async () => {
    const { user } = openSettings([ME_OWNER, { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' }])
    // 멤버 추가 역할 선택.
    await screen.findByTestId('member-add-trigger')
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
    await screen.findByTestId('member-remove-2')
    const firstRow = within(screen.getByRole('table')).getAllByRole('row')[1]
    expect(firstRow).toHaveClass('hover:bg-accent/50', 'transition-colors')
  })
})

describe('멤버 추가 — 사람·조직 선택 창 (WP-1057)', () => {
  test('검색 → 사람 클릭 → POST {userId, role: MEMBER} + 토스트 + 표 갱신', async () => {
    const requests = recordRequests()
    const { user } = openSettings([ME_OWNER])
    const popover = await openPicker(user, 'ali')
    // 검색 결과가 온 뒤(디바운스) 고를 수 있다 — 그 전 줄은 비활성이다.
    const row = () => within(popover).getByTestId(`project-member-picker-person-${HUMAN1.userId}`)
    await waitFor(() => expect(row()).not.toHaveAttribute('aria-disabled', 'true'))
    await user.click(row())
    await waitFor(() => expect(requests.bodies('POST', MEMBERS_PATH)).toEqual([{ userId: HUMAN1.userId, role: 'MEMBER' }]))
    expect(await screen.findByText('Alice 을(를) 추가했습니다')).toBeInTheDocument()
    // 선택 창은 연속 추가를 위해 열려 있다(모달이라 뒤 표가 가려진다) — 닫고 표를 본다.
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('row', { name: /Alice/ })).toBeInTheDocument()
  })

  test('추가 역할을 소유자로 고르면 사람은 소유자로 POST 한다', async () => {
    const requests = recordRequests()
    const { user } = openSettings([ME_OWNER])
    await screen.findByTestId('member-add-trigger')
    await user.click(document.getElementById('new-member-role')!)
    await user.click(await screen.findByRole('option', { name: '소유자' }))
    const popover = await openPicker(user, 'bob')
    // 검색 결과가 온 뒤(디바운스) 고를 수 있다 — 그 전 줄은 비활성이다.
    const row = () => within(popover).getByTestId(`project-member-picker-person-${HUMAN2.userId}`)
    await waitFor(() => expect(row()).not.toHaveAttribute('aria-disabled', 'true'))
    await user.click(row())
    await waitFor(() => expect(requests.bodies('POST', MEMBERS_PATH)).toEqual([{ userId: HUMAN2.userId, role: 'OWNER' }]))
  })

  test('검색어 없이 열면 kind=ALL 기본 후보 — AI 에이전트 포함, 비활성 제외 (#734)', async () => {
    const requests = recordRequests()
    const { user } = openSettings([])
    const popover = await openPicker(user)
    expect(await within(popover).findByTestId(`project-member-picker-person-${HUMAN2.userId}`)).toBeInTheDocument()
    expect(within(popover).getByTestId(`project-member-picker-person-${AGENT1.userId}`)).toHaveTextContent('에이전트')
    expect(within(popover).queryByTestId(`project-member-picker-person-${INACTIVE.userId}`)).not.toBeInTheDocument()
    expect(requests.of('GET', '/api/v1/members').some((r) => (r.search.get('search') ?? '') === '' && r.search.get('kind') === 'ALL')).toBe(true)
  })

  test('이미 직접 멤버인 사람은 (이미 추가됨)·비활성이고 눌러도 POST 가 없다', async () => {
    const requests = recordRequests()
    const { user } = openSettings([{ userId: HUMAN1.userId, username: 'alice', name: 'Alice', role: 'MEMBER' }])
    const popover = await openPicker(user, 'alice')
    const row = await within(popover).findByTestId(`project-member-picker-person-${HUMAN1.userId}`)
    await waitFor(() => expect(row).toHaveAttribute('aria-disabled', 'true'))
    expect(row).toHaveTextContent('(이미 추가됨)')
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    expect(requests.count('POST', MEMBERS_PATH)).toBe(0)
  })
})

describe('멤버 제거 확인창 (#139·WP-488)', () => {
  test('제거 → 확인창, 취소하면 DELETE 가 없다', async () => {
    const requests = recordRequests()
    const { user } = openSettings([ME_OWNER, { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' }])
    await user.click(await screen.findByTestId('member-remove-2'))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('멤버 제거')
    await user.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(requests.count('DELETE', `${MEMBERS_PATH}/2`)).toBe(0)
  })

  test('확인창이 담당 이슈 수를 알리고, 제거를 누르면 DELETE + 토스트', async () => {
    const requests = recordRequests()
    const { user } = openSettings([ME_OWNER, { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' }])
    await user.click(await screen.findByTestId('member-remove-2'))
    expect(await screen.findByTestId('delete-impact')).toHaveTextContent('담당 중인 이슈 2개에서 담당자가 해제됩니다.')
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '제거' }))
    await waitFor(() => expect(requests.count('DELETE', `${MEMBERS_PATH}/2`)).toBe(1))
    expect(await screen.findByText('멤버를 제거했습니다')).toBeInTheDocument()
  })
})

// WP-479 — OWNER 가 아닌 MEMBER 에게는 소유자 전용 조작을 보이지 않는다(예전엔 눌러야 403 이 났다).
test('MEMBER 로 연 프로젝트 설정은 소유자 전용 조작을 숨기고 읽기 전용 안내를 보인다', async () => {
  openSettingsPage([
    { userId: 1, username: 'me', name: 'Me', role: 'MEMBER' },
    { userId: 2, username: 'boss', name: 'Boss', role: 'OWNER' },
  ])
  expect(await screen.findByTestId('project-settings-readonly')).toBeInTheDocument()
  expect(document.getElementById('settings-name')).toBeDisabled()
  expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('member-add-trigger')).not.toBeInTheDocument()
  expect(screen.queryByTestId('member-remove-2')).not.toBeInTheDocument()
  expect(await screen.findByTestId('member-role-2')).toHaveTextContent('소유자')
  expect(screen.queryByTestId('project-delete')).not.toBeInTheDocument()
})
