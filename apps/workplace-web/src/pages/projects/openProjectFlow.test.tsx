// OPEN 접수함 — 비멤버(보고자)와 멤버(처리팀)의 이슈 상세 권한 표시, 보고자 건의가 홈 「내 작업」에 보이는지 — 페이지 테스트(WP-980).
// 상세의 편집 게이트(상태·사이클·에픽 연결·삭제·하위 추가)는 응답 권한 플래그 → 비활성/숨김으로 브라우저 없이 판정되므로
// e2e/pages/projects/open-project-flow.spec.ts 에서 옮겼다. 비멤버가 상세를 열 때 하위 조회가 이어지는 배선(@wiring)은 그 spec 에 남는다.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { issueDetailHandlers } from '@/test/kits/projects/issueDetailEvents'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'

const KEY = 'OPNQA'

/** OPEN 프로젝트의 보고자 본인 건의(1번)를 주어진 권한으로 띄운다. */
async function openDetail(perms: { viewerIsMember: boolean; viewerCanEditContent: boolean; viewerCanEditWorkflow: boolean; viewerCanDelete: boolean }) {
  const { viewerIsMember, ...flags } = perms
  const detail = createIssueDetail({ summary: createIssue({ projectKey: KEY, number: 1, title: '다크모드 추가 건의', reporterId: 1 }), ...flags })
  renderPage(`/projects/${KEY}/issues/1`, {
    handlers: issueDetailHandlers({ key: KEY, detail, project: createProject({ key: KEY, type: 'OPEN', viewerIsMember }) }),
  })
  await screen.findByTestId('issue-title-edit', {}, { timeout: PAGE_LOAD_TIMEOUT })
}

describe('OPEN 이슈 상세 권한', () => {
  // 보고자는 내용만 고칠 수 있다 — 워크플로(상태·사이클·에픽 연결, WP-481)·삭제·하위 추가(WP-477)는 저장하면 403 이라 막는다.
  test('비멤버(보고자): 제목 편집만 열리고 상태·사이클·에픽 연결은 비활성, 삭제·하위 추가는 없다', async () => {
    await openDetail({ viewerIsMember: false, viewerCanEditContent: true, viewerCanEditWorkflow: false, viewerCanDelete: false })
    expect(screen.getByTestId('issue-title-edit')).toBeEnabled()
    expect(screen.getByTestId('issue-status-select')).toBeDisabled()
    expect(screen.getByTestId('cycle-picker-trigger')).toBeDisabled()
    expect(screen.getByTestId('issue-parent-edit')).toBeDisabled()
    expect(screen.queryByTestId('issue-delete')).not.toBeInTheDocument()
    expect(screen.getByTestId('issue-children-section')).toBeInTheDocument()
    expect(within(screen.getByTestId('issue-children-section')).queryByTestId('child-add-form')).not.toBeInTheDocument()
    // 채팅 스레드 조회가 막히면 버튼 자체가 사라지던 함정 — 비멤버에게도 보인다.
    expect(screen.getByTestId('issue-chat-open')).toBeInTheDocument()
  })

  test('멤버(처리팀): 상태 변경·제목 편집·삭제가 모두 열린다', async () => {
    await openDetail({ viewerIsMember: true, viewerCanEditContent: true, viewerCanEditWorkflow: true, viewerCanDelete: true })
    expect(screen.getByTestId('issue-status-select')).toBeEnabled()
    expect(screen.getByTestId('issue-title-edit')).toBeEnabled()
    expect(screen.getByTestId('issue-delete')).toBeInTheDocument()
  })
})

describe('OPEN 보고자 건의 — 홈', () => {
  test('보고자가 제출한 건의가 홈 「내 작업」 위젯에 보인다', async () => {
    const mine = createIssue({ projectKey: KEY, number: 1, title: '다크모드 추가 건의', reporterId: 1 })
    renderPage('/', {
      handlers: [
        http.get('/api/v1/me/issues', () => HttpResponse.json({ items: [mine], nextCursor: null, hasMore: false })),
        http.get('/api/v1/me/dashboard', () => HttpResponse.json({ widgets: [{ type: 'my_tasks', count: 5, hidden: false }] })),
      ],
    })
    const widget = await screen.findByTestId('dash-mytasks', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(await within(widget).findByText('다크모드 추가 건의')).toBeInTheDocument()
  })
})
