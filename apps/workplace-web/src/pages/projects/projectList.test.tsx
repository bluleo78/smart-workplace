// 프로젝트 목록(모니터링 리스트) — 화면 테스트(WP-971, WP-1002 에서 작업 모듈 레이아웃·목록 화면만 띄우게 바꿈).
// 배지·유형 칩, 즐겨찾기 핀·사용자별 저장 키(WP-701), 행 클릭 이동, 빈 상태, 여러 페이지 이어 받기·이름순(WP-863)은
// 브라우저 없이 판정되므로 e2e/pages/projects/project-list.spec.ts 에서 옮겼다. 그 spec 에는 목록 API → 행 배선 1건(@wiring)이 남는다.
// 주의: useProjectFavorites 는 키별 스냅샷을 모듈 안에 캐시하므로(localStorage 는 테스트마다 비워져도 캐시는 남는다)
// 남의 키를 미리 심어 두는 WP-701 테스트는 파일 맨 앞에 둔다 — 앞 테스트가 같은 키를 이미 읽어 캐시했다면 심은 값을 보지 않아 거짓으로 통과한다.
import { screen, waitFor, within } from '@testing-library/react'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { IssueModuleLayout } from '@/components/issue/IssueModuleLayout'
import ProjectListPage from '@/pages/projects/ProjectListPage'
import { renderScreen } from '@/test/renderScreen'

import { createProject } from '../../../e2e/factories/project.factory'
import { createPageResponse } from '../../../e2e/fixtures/api-mock'

const projects = [
  createProject({ key: 'EX', name: '예제', type: 'TEAM', issueTotal: 18, issueDone: 11, memberCount: 4, memberNames: ['김하나', '이둘', '박셋'] }),
  createProject({ key: 'EMP', name: '빈 프로젝트', type: 'TEAM', issueTotal: 0, issueDone: 0, memberCount: 1, memberNames: ['최멤버'] }),
  createProject({ key: 'DONE1', name: '완료 프로젝트', type: 'TEAM', issueTotal: 12, issueDone: 12, memberCount: 2, memberNames: ['한', '서'] }),
]

/**
 * /projects 를 작업 모듈 레이아웃(사이드바)과 목록 화면만으로 띄운다 — 즐겨찾기는 사이드바에도 반영되므로 둘 다 둔다.
 * 행을 눌러 가는 상세는 띄우지 않고 주소로 본다. 화면이 부르는 조회는 프로젝트 목록과 고정한 뷰(사이드바)다.
 */
function renderProjects(handlers: RequestHandler[]) {
  return renderScreen(
    <Routes>
      <Route element={<IssueModuleLayout />}>
        <Route path="/projects" element={<ProjectListPage />} />
      </Route>
    </Routes>,
    { path: '/projects', handlers: [...handlers, http.get('/api/v1/me/pinned-views', () => HttpResponse.json([]))] },
  )
}

/** 목록을 연다 — 기본은 세 프로젝트 한 페이지. */
async function open(list = projects) {
  return renderProjects([http.get('/api/v1/projects', () => HttpResponse.json(createPageResponse(list)))])
}

describe('프로젝트 목록', () => {
  // WP-701 — 같은 브라우저의 다른 사용자(또는 예전 브라우저 단위 키)가 고른 즐겨찾기는 내 목록에 보이지 않는다.
  test('다른 사용자·예전 브라우저 단위로 저장된 즐겨찾기는 보이지 않는다 (WP-701)', async () => {
    localStorage.setItem('project-favorites', JSON.stringify(['DONE1']))
    localStorage.setItem('project-favorites:99:1', JSON.stringify(['DONE1']))
    await open()
    expect(await screen.findByTestId('project-row-DONE1')).toBeInTheDocument()
    expect(screen.queryByTestId('fav-group')).not.toBeInTheDocument()
    expect(screen.getByTestId('fav-toggle-DONE1')).toHaveAttribute('aria-pressed', 'false')
  })

  test('행에 프로젝트 키 컬러 배지와 유형 칩(TEAM → 팀)이 보인다', async () => {
    await open()
    const row = await screen.findByTestId('project-row-EX')
    // 사이드바에도 같은 testid 배지가 있어 행 안에서 찾는다.
    expect(within(row).getByTestId('project-badge-EX')).toHaveTextContent(/^EX$/)
    expect(row).toHaveTextContent('팀')
  })

  test('목록이 비면 빈 상태를 보인다', async () => {
    await open([])
    expect(await screen.findByTestId('projects-empty')).toBeInTheDocument()
  })

  test('행의 링크를 누르면 그 프로젝트 상세로 이동한다', async () => {
    const { user, location } = await open()
    const row = await screen.findByTestId('project-row-EX')
    await user.click(within(row).getByRole('link'))
    await waitFor(() => expect(location()).toMatch(/^\/projects\/EX(\?|$)/))
  })

  test('즐겨찾기를 켜면 핀 그룹이 생기고 사용자별 키(project-favorites:1:…)에만 저장된다', async () => {
    const { user } = await open()
    await user.click(await screen.findByTestId('fav-toggle-DONE1'))
    expect(await screen.findByTestId('fav-group')).toBeInTheDocument()
    const stored = Object.keys(localStorage)
      .filter((k) => k.startsWith('project-favorites'))
      .map((k) => [k, localStorage.getItem(k)])
    expect(stored).toHaveLength(1)
    expect(stored[0][0]).toMatch(/^project-favorites:1:/)
    expect(stored[0][1]).toContain('DONE1')
  })

  // WP-863 — 첫 페이지(20개)만 받아 21번째부터 목록·이름순 정렬·즐겨찾기에서 사라졌다. 끝 페이지까지 이어 받는다.
  test('한 페이지를 넘어도 마지막 페이지까지 받아 목록·이름순·즐겨찾기 사이드바에 모두 보인다 (WP-863)', async () => {
    // 최근 생성순 130개 — 가장 오래된 「가나다 기획실」(OLD)은 두 번째 페이지 끝에 있다.
    const many = [
      ...Array.from({ length: 129 }, (_, i) =>
        createProject({ id: 1000 + i, key: `T${String(i + 1).padStart(3, '0')}`, name: `팀 프로젝트 ${i + 1}`, type: 'TEAM' }),
      ),
      createProject({ id: 2000, key: 'OLD', name: '가나다 기획실 — 오래전에 만든 프로젝트', type: 'TEAM' }),
    ]
    const requested: string[] = []
    const { user } = renderProjects([
        http.get('/api/v1/projects', ({ request }) => {
          const url = new URL(request.url)
          const p = Number(url.searchParams.get('page') ?? 0)
          const size = Number(url.searchParams.get('size') ?? 20)
          requested.push(`${p}/${size}`)
          return HttpResponse.json(createPageResponse(many.slice(p * size, (p + 1) * size), { page: p, size, totalElements: many.length }))
        }),
    ])
    expect(await screen.findByTestId('project-row-OLD')).toBeInTheDocument()
    const rows = () => document.querySelectorAll('[data-testid^="project-row-"]')
    expect(rows()).toHaveLength(130)
    expect(requested).toEqual(expect.arrayContaining(['0/100', '1/100']))

    // 이름순은 받은 전체 기준 — 「가나다…」가 맨 위.
    await user.click(screen.getByTestId('project-sort-toggle'))
    await waitFor(() => expect(rows()[0]).toHaveAttribute('data-testid', 'project-row-OLD'))

    // 즐겨찾기하면 사이드바 프로젝트 묶음에도 나온다(전에는 사이드바도 20개 안에서만 골랐다).
    await user.click(screen.getByTestId('fav-toggle-OLD'))
    expect(await screen.findByTestId('team-project-OLD')).toBeInTheDocument()
  })
})
