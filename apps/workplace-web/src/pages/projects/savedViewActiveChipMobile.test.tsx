// 저장한 뷰 고르기 표시 — 모바일(WP-1022). 데스크톱(savedViewActiveChip.test.tsx)과 같은 훅을 쓰는 모바일 뷰 칩·뷰 시트.
// 그룹만 담은 뷰를 고르면 칩 라벨이 「전체」가 아니라 그 이름이고 시트의 ✓ 도 그 뷰에 있다.
// 고른 뒤 조건을 바꾸면 라벨에 「수정됨」, 시트에 「되돌리기」가 보이고, 되돌리면 저장된 조건으로 돌아간다.
import { fireEvent, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test, vi } from 'vitest'

import { MOBILE_MEDIA_QUERY } from '@/lib/mobile/breakpoint'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { SavedViewResponse } from '@/types/savedView'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'

// 모바일 폭으로 판정되게 한다 — 진짜 matchMedia 는 모듈에서 한 번만 잡는다(앞 테스트 스파이를 감싸 무한 재귀 방지).
const realMatchMedia = window.matchMedia.bind(window)
beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const mql = realMatchMedia(query)
    return query === MOBILE_MEDIA_QUERY ? ({ ...mql, matches: true, media: query } as MediaQueryList) : mql
  })
})

const VIEW: SavedViewResponse = {
  id: 1,
  name: 'Soon',
  query: 'group=assignee',
  visibility: 'PRIVATE',
  ownerId: 1,
  mine: true,
  pinned: false,
  createdAt: '2026-10-26T00:00:00Z',
  updatedAt: '2026-10-26T00:00:00Z',
}

const handlers = [
  http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))),
  http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
  http.get(`/api/v1/projects/${KEY}/members`, () =>
    HttpResponse.json([createMember({ userId: 1, name: '테스트 사용자', username: 'testuser', role: 'OWNER' })]),
  ),
  http.get(`/api/v1/projects/${KEY}/saved-views`, () => HttpResponse.json([VIEW])),
  http.get(`/api/v1/projects/${KEY}/issues/group-counts`, ({ request }) =>
    HttpResponse.json({ groupBy: new URL(request.url).searchParams.get('groupBy') ?? 'assignee', groups: [] }),
  ),
  http.get(`/api/v1/projects/${KEY}/issues`, () =>
    HttpResponse.json(
      createIssueSearchResponse([createIssue({ id: 1, number: 7, projectKey: KEY, title: '로그인 세션 만료 처리', type: makeTaskType() })], null),
    ),
  ),
]

test('그룹만 담은 뷰를 고르면 칩 라벨·시트 ✓ 가 그 뷰다 — 조건을 바꾸면 「수정됨」, 되돌리면 사라진다', async () => {
  const { location } = renderPage(`/projects/${KEY}`, { handlers })
  const chip = await screen.findByTestId('mobile-chip-view', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(chip).toHaveTextContent('전체')

  fireEvent.click(chip)
  fireEvent.click(await screen.findByTestId('mobile-view-option-1'))
  expect(await screen.findByTestId('mobile-chip-view')).toHaveTextContent('Soon')
  fireEvent.click(screen.getByTestId('mobile-chip-view'))
  expect(await screen.findByTestId('mobile-view-option-1')).toHaveAttribute('aria-current', 'true')
  expect(screen.getByTestId('mobile-view-option-all')).not.toHaveAttribute('aria-current')
  // 시트의 같은 뷰를 다시 고르면 시트가 닫힌다(조건은 그대로).
  fireEvent.click(screen.getByTestId('mobile-view-option-1'))

  // 조건을 바꾼다 — 그룹 시트에서 우선순위로.
  fireEvent.click(await screen.findByTestId('mobile-chip-group'))
  fireEvent.click(await screen.findByTestId('picker-option-priority'))
  expect(await screen.findByTestId('mobile-chip-view-modified')).toHaveTextContent('수정됨')
  expect(screen.getByTestId('mobile-chip-view')).toHaveTextContent('Soon')

  // 뷰 시트의 「되돌리기」 — 저장된 조건(담당자 그룹)으로 돌아가고 「수정됨」이 사라진다.
  fireEvent.click(screen.getByTestId('mobile-chip-view'))
  fireEvent.click(await screen.findByTestId('mobile-view-revert'))
  expect(await screen.findByTestId('mobile-chip-view')).toHaveTextContent('Soon')
  expect(screen.queryByTestId('mobile-chip-view-modified')).not.toBeInTheDocument()
  expect(new URLSearchParams(location().split('?')[1]).get('group')).toBe('assignee')
})
