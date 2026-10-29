// 프로젝트 설정 「프로젝트 필드」 목록의 줄 배치 E2E(WP-1124) 목 — 옵션이 많은 선택 필드와, 이름·옵션이 긴 복수 선택 필드.
import type { Page } from '@playwright/test'

import type { FieldType } from '../../src/types/customField'
import { mockApi } from './api-mock'

/** 옵션 15개 선택 필드 — 옵션 칩이 한 줄에 다 들어가지 않는다. */
export const MANY_OPTIONS_ID = 401
/** 이름 40자 + 띄어쓰기 없는 40자 옵션 3개 복수 선택 필드 — 서버 허용 상한. */
export const LONG_FIELD_ID = 402
export const LONG_FIELD_NAME = '고객사별 보안 검토와 법무 확인이 필요한 영향 범위 분류 기준 필드'.slice(0, 40)

type FieldDef = {
  id: number
  projectId: number
  name: string
  type: FieldType
  options: string[] | null
  position: number
  createdAt: string
  updatedAt: string
}

/** mockProjectSettings 뒤에 불러 필드 목록 GET 을 덮는다(나중 등록이 우선). */
export async function mockCustomFieldRows(page: Page, projectKey = 'WP') {
  const now = new Date().toISOString()
  const fields: FieldDef[] = [
    {
      id: MANY_OPTIONS_ID, projectId: 1, name: '담당 팀', type: 'SELECT', position: 0, createdAt: now, updatedAt: now,
      options: ['프론트엔드', '백엔드', '인프라', '디자인', '기획', 'QA', '데이터', '보안', '모바일', '운영', '고객지원', '마케팅', '영업', '재무', '인사'],
    },
    {
      id: LONG_FIELD_ID, projectId: 1, name: LONG_FIELD_NAME, type: 'MULTI_SELECT', position: 1, createdAt: now, updatedAt: now,
      options: ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)],
    },
  ]
  await mockApi(page, 'GET', `/api/v1/projects/${projectKey}/fields`, fields)
}
