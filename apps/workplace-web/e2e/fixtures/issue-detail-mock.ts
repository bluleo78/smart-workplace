// 이슈 상세 화면 목(WP-12 · "로그인 버그 수정") — AI 화면 컨텍스트·추천 spec 이 같은 화면을 쓰므로 한 곳에 둔다.
// projects.spec.ts 의 이슈 상세 단계와 같은 목 집합.
import type { Page } from '@playwright/test'

import { createIssue, createIssueDetail } from '../factories/issue.factory'
import { createProject } from '../factories/project.factory'
import { mockApi } from './api-mock'

export async function mockIssueDetail(page: Page) {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject())
  await mockApi(
    page, 'GET', '/api/v1/projects/WP/issues/12',
    createIssueDetail({ summary: createIssue({ number: 12, title: '로그인 버그 수정', status: 'IN_PROGRESS', priority: 'HIGH' }) }),
  )
}
