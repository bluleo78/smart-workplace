// 오픈 프로젝트 보고자 피커(WP-967) — 컴포넌트 테스트(WP-971).
// 후보 소스(워크스페이스 디렉터리)·조회 시점(팝오버를 열 때만)·검색 중/실패 상태·고른 사람 payload 는
// 브라우저 없이 판정되므로 E2E 대신 실제 훅 + MSW 로 지킨다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/renderWithProviders'

import { createMember } from '../../../../e2e/factories/project.factory'
import type { MemberSummary } from '../../../types/member'
import { IssueReporterField } from './IssueReporterField'

const KEY = 'OPN'
const NUMBER = 1
const KIM = { id: 5, username: 'kim', name: '김보고', kind: 'HUMAN' as const }

/** 워크스페이스 디렉터리 한 명 — 프로젝트 구성원이 아니어도 OPEN 프로젝트에서는 후보다. */
function dirMember(userId: number, name: string, username: string): MemberSummary {
  return { userId, username, name, email: null, title: null, kind: 'HUMAN', active: true, membershipRole: null, membershipStatus: null }
}

/** 프로젝트 구성원은 지금 보고자뿐, 디렉터리 조회 URL 은 directoryUrls 에 쌓는다. */
function openProjectApi(directory: (search: string) => Response | MemberSummary[]) {
  const directoryUrls: URL[] = []
  const putBodies: unknown[] = []
  server.use(
    http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([createMember({ userId: 5, username: 'kim', name: '김보고' })])),
    http.get('/api/v1/members', ({ request }) => {
      const url = new URL(request.url)
      directoryUrls.push(url)
      const res = directory(url.searchParams.get('search') ?? '')
      if (res instanceof Response) return res
      return HttpResponse.json({ content: res, page: 0, size: 20, totalElements: res.length, totalPages: 1 })
    }),
    http.put(`/api/v1/projects/${KEY}/issues/${NUMBER}/reporter`, async ({ request }) => {
      putBodies.push(await request.json())
      return HttpResponse.json({ id: 10, username: 'park', name: '박외부', kind: 'HUMAN' })
    }),
  )
  return { directoryUrls, putBodies }
}

function renderOpenPicker() {
  return renderWithProviders(
    <IssueReporterField
      reporter={KIM}
      createdAt="2026-10-26T00:00:00Z"
      layout="rail"
      edit={{ projectKey: KEY, issueNumber: NUMBER, currentUserId: 1, isOpenProject: true }}
    />,
  )
}

describe('오픈 프로젝트 보고자 피커 (WP-967)', () => {
  test('팝오버를 열 때만 디렉터리를 조회하고, 비구성원을 골라 보고자로 바꾼다', async () => {
    const api = openProjectApi((search) =>
      [dirMember(10, '박외부', 'park'), dirMember(11, '최외부', 'choi')].filter((m) => m.name.includes(search)),
    )
    renderOpenPicker()

    // 피커는 늘 마운트돼 있지만 열기 전에는 디렉터리 조회가 없다.
    await screen.findByTestId('reporter-picker-trigger')
    expect(api.directoryUrls).toHaveLength(0)

    fireEvent.click(screen.getByTestId('reporter-picker-trigger'))
    const picker = await screen.findByTestId('reporter-picker')
    expect(await within(picker).findByTestId('reporter-option-10')).toBeInTheDocument()

    // 검색어를 바꾼 직후(디바운스 동안)에는 옛 결과를 고를 수 없게 「검색 중…」만 보인다.
    fireEvent.change(within(picker).getByLabelText('멤버 검색'), { target: { value: '박' } })
    expect(within(picker).getByText('검색 중…')).toBeInTheDocument()
    expect(within(picker).queryByTestId('reporter-option-11')).toBeNull()

    // 따라잡으면 그 검색어로 조회하고, 걸러진 후보만 남는다.
    const option = await within(picker).findByTestId('reporter-option-10')
    expect(within(picker).queryByTestId('reporter-option-11')).toBeNull()
    expect(api.directoryUrls.at(-1)?.searchParams.get('search')).toBe('박')
    expect(api.directoryUrls.at(-1)?.searchParams.get('kind')).toBe('HUMAN')

    fireEvent.click(option)
    await waitFor(() => expect(api.putBodies).toEqual([{ userId: 10 }]))
  })

  test('디렉터리 조회가 실패하면 「결과 없음」 대신 실패를 알린다', async () => {
    openProjectApi(() => HttpResponse.json({}, { status: 500 }))
    renderOpenPicker()

    fireEvent.click(await screen.findByTestId('reporter-picker-trigger'))
    const picker = await screen.findByTestId('reporter-picker')
    expect(await within(picker).findByText('검색에 실패했습니다')).toBeInTheDocument()
    expect(within(picker).queryByText('결과 없음')).toBeNull()
  })
})
