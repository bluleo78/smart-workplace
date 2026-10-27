// 다른 프로젝트 에픽(WP-1039) — 이슈 상세의 상위 에픽 고르기와 에픽 하위 목록을 화면 단위(renderScreen + MSW)로 본다.
// 1) 상위 에픽 슬롯: 같은 프로젝트 에픽 아래 「다른 프로젝트」 묶음에 찾은 다른 프로젝트 에픽만 보이고, 고르면 PATCH /parent {parentKey}.
// 2) 에픽 하위 목록: 하위 목록 API(/children)의 다른 프로젝트 하위는 자기 키·링크로, 읽을 수 없는 하위는 「볼 수 없는 하위 N건」 한 줄로.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { IssueChildrenSection } from '@/pages/projects/components/IssueChildrenSection'
import { IssueParentSlot } from '@/pages/projects/components/IssueParentSlot'
import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { renderScreen } from '@/test/renderScreen'

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeEpicType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'

const API = '/api/v1'

describe('상위 에픽 고르기 — 다른 프로젝트 에픽', () => {
  test('찾은 결과 중 다른 프로젝트 에픽만 보이고, 고르면 PATCH /parent {parentKey:"PLAN-3"} 를 보낸다', async () => {
    const requests = recordRequests()
    const patches: unknown[] = []
    const { user } = renderScreen(
      <IssueParentSlot projectKey="WP" issueNumber={50} parent={null} isSubtask={false} />,
      {
        path: '/projects/WP/issues/50',
        handlers: [
          http.get(`${API}/projects/WP/types`, () => HttpResponse.json(systemTypes())),
          // 같은 프로젝트 에픽 목록(위쪽 후보) — WP-5.
          http.get(`${API}/projects/WP/issues`, () =>
            HttpResponse.json(createIssueSearchResponse([createIssue({ id: 5, number: 5, title: '계획 정비', type: makeEpicType() })])),
          ),
          // 관계 찾기 결과 — 유형·상태·같은 프로젝트 거름은 서버 몫(type·openOnly·excludeFrom)이지만, 같은 프로젝트 행이 섞여 와도 화면이 뺀다.
          http.get(`${API}/issues/lookup`, () =>
            HttpResponse.json([
              { projectKey: 'WP', number: 9, title: '계획 WP 에픽', status: 'TODO', type: makeEpicType() },
              { projectKey: 'PLAN', number: 3, title: '분기 계획', status: 'TODO', type: makeEpicType() },
            ]),
          ),
          http.patch(`${API}/projects/WP/issues/50/parent`, async ({ request }) => {
            patches.push(await request.json())
            return HttpResponse.json(createIssueDetail({ summary: createIssue({ number: 50 }) }))
          }),
        ],
      },
    )
    await user.click(screen.getByTestId('issue-parent-edit'))
    await user.type(await screen.findByTestId('parent-number-input'), '계획')

    const others = await screen.findByTestId('parent-other-epics')
    expect(within(others).getByText('다른 프로젝트')).toBeInTheDocument()
    expect(within(others).getAllByRole('option')).toHaveLength(1)
    expect(screen.getByTestId('parent-other-epic-option-PLAN-3')).toHaveTextContent('PLAN-3분기 계획')
    // 같은 프로젝트 에픽은 위쪽 후보(받아 둔 목록)로 보이고 다른 프로젝트 묶음에는 없다.
    expect(screen.getByTestId('parent-epic-option-5')).toBeInTheDocument()
    expect(screen.queryByTestId('parent-other-epic-option-WP-9')).not.toBeInTheDocument()
    // 찾기는 현재 프로젝트를 출발점(from)으로 묻는다 — 개인 프로젝트면 서버가 그 안으로 좁힌다.
    const lookup = requests.last('GET', `${API}/issues/lookup`)
    expect(lookup?.search.get('q')).toBe('계획')
    expect(lookup?.search.get('from')).toBe('WP')
    // 유형·열린 상태 거름은 서버가 상한(20건) 전에 건다 — 화면에서 거르면 다른 유형이 20건을 채워 에픽이 밀려났다.
    expect(lookup?.search.get('type')).toBe('EPIC')
    expect(lookup?.search.get('openOnly')).toBe('true')
    expect(lookup?.search.get('excludeFrom')).toBe('true')

    await user.click(screen.getByTestId('parent-other-epic-option-PLAN-3'))
    await waitFor(() => expect(patches).toEqual([{ parentKey: 'PLAN-3' }]))
  })

  test('같은 프로젝트 에픽을 고르면 예전처럼 PATCH /parent {parentNumber} — 번호만 친 입력은 다른 프로젝트를 찾지 않는다', async () => {
    const requests = recordRequests()
    const patches: unknown[] = []
    const { user } = renderScreen(
      <IssueParentSlot projectKey="WP" issueNumber={50} parent={null} isSubtask={false} />,
      {
        path: '/projects/WP/issues/50',
        handlers: [
          http.get(`${API}/projects/WP/types`, () => HttpResponse.json(systemTypes())),
          http.get(`${API}/projects/WP/issues`, () =>
            HttpResponse.json(createIssueSearchResponse([createIssue({ id: 5, number: 5, title: '계획 정비', type: makeEpicType() })])),
          ),
          http.get(`${API}/issues/lookup`, () => HttpResponse.json([])),
          http.patch(`${API}/projects/WP/issues/50/parent`, async ({ request }) => {
            patches.push(await request.json())
            return HttpResponse.json(createIssueDetail({ summary: createIssue({ number: 50 }) }))
          }),
        ],
      },
    )
    await user.click(screen.getByTestId('issue-parent-edit'))
    await user.type(await screen.findByTestId('parent-number-input'), '5')
    await user.click(await screen.findByTestId('parent-epic-option-5'))
    await waitFor(() => expect(patches).toEqual([{ parentNumber: 5 }]))
    expect(requests.count('GET', `${API}/issues/lookup`)).toBe(0)
  })
})

describe('에픽 하위 목록 — 다른 프로젝트 하위', () => {
  test('하위 목록 API 의 다른 프로젝트 하위는 자기 키·링크로, 읽을 수 없는 하위는 「볼 수 없는 하위 2건」으로 보인다', async () => {
    const requests = recordRequests()
    const epic = { number: 1, title: '분기 에픽', type: makeEpicType() }
    renderScreen(
      <IssueChildrenSection projectKey="WP" parentNumber={1} parentTypeName="EPIC" parentStatus="TODO" childCount={4} childDoneCount={1} />,
      {
        path: '/projects/WP/issues/1',
        handlers: [
          http.get(`${API}/projects/WP`, () => HttpResponse.json(createProject({ key: 'WP' }))),
          http.get(`${API}/projects/WP/types`, () => HttpResponse.json(systemTypes())),
          http.get(`${API}/projects/WP/issues/1/children`, () =>
            HttpResponse.json({
              items: [
                createIssue({ id: 2, number: 2, title: '같은 프로젝트 하위', createdAt: '2026-10-01T00:00:00Z', parent: epic }),
                createIssue({
                  id: 70,
                  projectKey: 'PLAN',
                  number: 7,
                  title: '다른 프로젝트 하위',
                  status: 'DONE',
                  createdAt: '2026-10-02T00:00:00Z',
                  parent: { ...epic, projectKey: 'WP' },
                }),
              ],
              hiddenCount: 2,
            }),
          ),
        ],
      },
    )
    const own = await screen.findByTestId('child-row-2')
    expect(within(own).getByRole('link', { name: '같은 프로젝트 하위' })).toHaveAttribute('href', '/projects/WP/issues/2')
    expect(within(own).queryByTestId('child-row-key')).not.toBeInTheDocument()

    const other = screen.getByTestId('child-row-PLAN-7')
    expect(within(other).getByTestId('child-row-key')).toHaveTextContent('PLAN-7')
    expect(within(other).getByRole('link', { name: '다른 프로젝트 하위' })).toHaveAttribute('href', '/projects/PLAN/issues/7')
    // 같은 번호의 이 프로젝트 이슈 행으로 그리지 않는다.
    expect(screen.queryByTestId('child-row-7')).not.toBeInTheDocument()

    expect(screen.getByTestId('child-hidden-count')).toHaveTextContent('볼 수 없는 하위 2건')
    expect(screen.getByTestId('child-progress-text')).toHaveTextContent('1/4')
    // 에픽 하위는 같은 프로젝트 검색(parent 필터)으로 묻지 않는다.
    expect(requests.count('GET', `${API}/projects/WP/issues`)).toBe(0)
  })

  test('읽을 수 없는 하위만 있어도 「볼 수 없는 하위 N건」 줄은 보인다', async () => {
    renderScreen(
      <IssueChildrenSection projectKey="WP" parentNumber={1} parentTypeName="EPIC" parentStatus="TODO" childCount={1} childDoneCount={0} />,
      {
        path: '/projects/WP/issues/1',
        handlers: [
          http.get(`${API}/projects/WP`, () => HttpResponse.json(createProject({ key: 'WP' }))),
          http.get(`${API}/projects/WP/types`, () => HttpResponse.json(systemTypes())),
          http.get(`${API}/projects/WP/issues/1/children`, () => HttpResponse.json({ items: [], hiddenCount: 1 })),
        ],
      },
    )
    expect(await screen.findByTestId('child-hidden-count')).toHaveTextContent('볼 수 없는 하위 1건')
  })
})
