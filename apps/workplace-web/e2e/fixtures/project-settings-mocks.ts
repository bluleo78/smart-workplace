// e2e/fixtures/project-settings-mocks.ts
// 프로젝트 설정(/projects/WP/settings) 진입에 필요한 GET 목 — 데스크톱·모바일 레이아웃 스펙이 함께 쓴다(WP-397).
import type { Page } from '@playwright/test'

import type { ProjectResponse } from '../../src/types/project'
import { createMember, createProject } from '../factories/project.factory'
import { mockApi } from './api-mock'

type Member = ReturnType<typeof createMember>

/** 기본 멤버 — 현재 사용자(id=1)가 OWNER. */
const DEFAULT_MEMBERS: Member[] = [createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })]

/**
 * 프로젝트(기본 WP)·멤버 목록을 목 처리하고 라벨·유형·필드는 빈 목록으로 응답한다.
 * mockApi 는 GET 만 받으므로 추가·삭제 등 다른 요청은 테스트별 목이 받는다.
 * project 를 넘기면 그 프로젝트(키 포함)로 응답한다 — 개인·기본 프로젝트 등(WP-857).
 */
export async function mockProjectSettings(
  page: Page,
  members: Member[] = DEFAULT_MEMBERS,
  project: ProjectResponse = createProject(),
) {
  const base = `/api/v1/projects/${project.key}`
  await mockApi(page, 'GET', base, project)
  await mockApi(page, 'GET', `${base}/members`, members)
  for (const path of ['labels', 'types', 'fields']) {
    await mockApi(page, 'GET', `${base}/${path}`, [])
  }
}
