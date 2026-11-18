// 이슈 상세 헤더 경로(WP-1736) — 컴포넌트 테스트(WP-971).
// 에픽 › 스토리 › 하위 태스크에서 할아버지 에픽(parent.epic) 크럼이 부모 앞에 들어가는지, 가려진 에픽·부모가 에픽인 경우는
// 크럼 순서·링크·문구만 보면 되므로 브라우저 없이 판정한다.
import { screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import type { ParentRef } from '../../../types/issue'
import type { IssueTypeSummary } from '../../../types/issueType'
import { IssueBreadcrumbHeader } from './IssueBreadcrumbHeader'

const EPIC: IssueTypeSummary = { id: 1, name: 'EPIC', colorToken: 'purple', icon: 'Zap' }
const STORY: IssueTypeSummary = { id: 2, name: 'STORY', colorToken: 'green', icon: 'BookOpen' }
const SUBTASK: IssueTypeSummary = { id: 3, name: 'SUBTASK', colorToken: 'blue', icon: 'CornerDownRight' }

/** 헤더를 그리고 경로 nav 안의 크럼 testId 를 순서대로 돌려준다. */
function renderHeader(parent: ParentRef | null) {
  renderScreen(
    <IssueBreadcrumbHeader
      projectKey="WP"
      projectName="Gen:iA Works"
      parent={parent}
      number={1688}
      type={SUBTASK}
      onBack={() => {}}
      actions={null}
    />,
    { path: '/projects/WP/issues/1688' },
  )
  const nav = screen.getByTestId('issue-breadcrumb')
  return Array.from(nav.querySelectorAll('[data-testid^="breadcrumb-"]')).map((el) => el.getAttribute('data-testid'))
}

describe('이슈 상세 경로의 에픽 단계 (WP-1736)', () => {
  test('스토리 부모에 parent.epic 이 있으면 프로젝트 › 에픽 › 스토리 › 현재 순서이고 에픽 크럼은 에픽 상세로 간다', () => {
    const order = renderHeader({
      number: 1669,
      title: '스토리',
      type: STORY,
      epic: { number: 1600, title: '에픽', type: EPIC },
    })
    expect(order).toEqual(['breadcrumb-epic-1600', 'breadcrumb-parent-1669', 'breadcrumb-current'])
    const epic = screen.getByTestId('breadcrumb-epic-1600')
    expect(epic).toHaveTextContent('WP-1600')
    expect(epic.closest('a') ?? within(epic).getByRole('link')).toHaveAttribute('href', '/projects/WP/issues/1600')
  })

  test('다른 프로젝트 에픽이면 그 프로젝트 키·경로로 보인다', () => {
    renderHeader({
      number: 1669,
      title: '스토리',
      type: STORY,
      epic: { number: 3, title: '기획 에픽', type: EPIC, projectKey: 'PLAN' },
    })
    const epic = screen.getByTestId('breadcrumb-epic-3')
    expect(epic).toHaveTextContent('PLAN-3')
    expect(epic.closest('a') ?? within(epic).getByRole('link')).toHaveAttribute('href', '/projects/PLAN/issues/3')
  })

  test('가려진 에픽이면 링크 없이 「볼 수 없는 에픽」', () => {
    const order = renderHeader({
      number: 1669,
      title: '스토리',
      type: STORY,
      epic: { number: 0, title: '', type: EPIC, hidden: true },
    })
    expect(order).toEqual(['breadcrumb-epic-hidden', 'breadcrumb-parent-1669', 'breadcrumb-current'])
    const hidden = screen.getByTestId('breadcrumb-epic-hidden')
    expect(hidden).toHaveTextContent('볼 수 없는 에픽')
    expect(hidden.closest('a')).toBeNull()
    expect(within(hidden).queryByRole('link')).toBeNull()
  })

  test('직계 부모가 에픽이면 지금처럼 부모 크럼 하나만(에픽 중복 없음)', () => {
    const order = renderHeader({
      number: 1600,
      title: '에픽',
      type: EPIC,
      epic: { number: 9, title: '섞여 온 값', type: EPIC },
    })
    expect(order).toEqual(['breadcrumb-parent-1600', 'breadcrumb-current'])
  })

  test('부모가 없으면 프로젝트 › 현재', () => {
    expect(renderHeader(null)).toEqual(['breadcrumb-current'])
  })
})
