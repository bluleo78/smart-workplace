// 이슈 상세 화면 목(WP-12 · "로그인 버그 수정") — AI 화면 컨텍스트·추천 spec 이 같은 화면을 쓰므로 한 곳에 둔다.
// projects.spec.ts 의 이슈 상세 단계와 같은 목 집합.
import type { Page } from '@playwright/test'

import { createChatThread } from '../factories/chat.factory'
import { createIssue, createIssueDetail } from '../factories/issue.factory'
import { createProject } from '../factories/project.factory'
import type { AgentWorkView, IssueResponse } from '../../src/types/issue'
import { mockApi } from './api-mock'

/** 이슈 상세 목 — summary 를 덮어쓸 수 있다(WP-377: agentWork 등). 기존 호출(인자 없음)은 그대로 동작한다. */
export async function mockIssueDetail(page: Page, summary: Partial<IssueResponse> = {}) {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject())
  await mockApi(
    page, 'GET', '/api/v1/projects/WP/issues/12',
    createIssueDetail({ summary: createIssue({ number: 12, title: '로그인 버그 수정', status: 'IN_PROGRESS', priority: 'HIGH', ...summary }) }),
  )
}

const json = (b: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })

/**
 * AI 진행(WP-377) 상세 목 — WP-12 에 agentWork 를 싣고, 상세가 부르는 부속 API(구성원·구독·라벨·첨부·드라이브)와
 * 채팅 스레드·메시지를 빈 응답으로 막는다(「채팅에서 답하기」로 드로워를 열어도 백엔드 프록시로 새지 않게).
 */
export async function mockAgentWorkDetail(page: Page, agentWork: AgentWorkView[] | undefined, summary: Partial<IssueResponse> = {}) {
  const base = '/api/v1/projects/WP/issues/12'
  await page.route((u) => u.pathname === '/api/v1/projects/WP/members', (r) => r.fulfill(json([])))
  await page.route((u) => u.pathname === '/api/v1/projects/WP/labels', (r) => r.fulfill(json([])))
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill(json([])))
  await page.route((u) => ['watchers', 'labels', 'attachments', 'drive-links'].some((s) => u.pathname === `${base}/${s}`), (r) => r.fulfill(json([])))
  await page.route((u) => u.pathname === `${base}/chat/thread`, (r) => r.fulfill(json(createChatThread({ threadId: 777, recentMessages: [] }))))
  await page.route((u) => u.pathname === '/api/v1/chat/threads/777/messages', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json({ items: [], nextCursor: null, hasMore: false })) : r.fallback())
  await mockIssueDetail(page, { ...summary, ...(agentWork ? { agentWork } : {}) })
}
