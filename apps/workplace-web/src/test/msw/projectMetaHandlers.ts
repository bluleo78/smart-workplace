// 마일스톤·사이클 관리 권한(WP-1008) 페이지 테스트 공용 MSW 응답 — 사이클 화면·타임라인이 부르는 것을 한꺼번에 준다.
import { act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect } from 'vitest'

import { memberKeys } from '@/hooks/queries/useProjectMembers'
import type { MemberResponse } from '@/types/project'

import { createCycle } from '../../../e2e/factories/cycle.factory'
import { createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import type { renderPage } from '../renderPage'
import { BASE, KEY } from './versionHandlers'

const CYCLE = createCycle({ startDate: '2026-11-02', endDate: '2026-11-08' })

/** 프로젝트(멤버로 봄)·구성원·사이클·이슈 목록 — 사이클·타임라인 화면이 부르는 것을 한꺼번에 준다. */
export function projectMetaHandlers(members: MemberResponse[]) {
  return [
    http.get(BASE, () => HttpResponse.json(createProject({ key: KEY, viewerIsMember: true }))),
    http.get(`${BASE}/members`, () => HttpResponse.json(members)),
    http.get(`${BASE}/cycles`, () => HttpResponse.json([CYCLE])),
    http.get(`${BASE}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`${BASE}/issues`, () => HttpResponse.json(createIssueSearchResponse([], null))),
    http.get(`${BASE}/issue-dependencies`, () => HttpResponse.json([])),
    http.get(`${BASE}/views`, () => HttpResponse.json([])),
    http.get(`${BASE}/fields`, () => HttpResponse.json([])),
  ]
}

/** 구성원 응답이 캐시에 들어가고(권한 판정 입력) 그 결과로 다시 그려질 때까지 기다린다 — 그 전의 「없음」 은 판정 전이라 의미가 없다. */
export async function settleMembers(view: ReturnType<typeof renderPage>) {
  await waitFor(() => expect(view.queryClient.getQueryState(memberKeys.all(KEY))?.status).toBe('success'))
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}
