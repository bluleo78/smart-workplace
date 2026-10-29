// 이슈 상세 커스텀 필드 정의 목 — 복수 선택 필드 하나(띄어쓰기 없는 40자 옵션 포함)를 GET /fields 로 준다(WP-1122 칩 폭 E2E).
import type { Page } from '@playwright/test'

import type { FieldType } from '../../src/types/customField'

/** 서버 허용 상한(FieldTypeValidator.OPTION_MAX = 40자)의 띄어쓰기 없는 옵션 — 끊을 자리가 없는 최악의 칩. */
export const LONG_OPTION = 'W'.repeat(40)

/** 프로젝트 필드 정의 GET 에 복수 선택 필드 하나를 돌려준다. 만든 필드 id 를 돌려준다. */
export async function stubMultiSelectField(page: Page, projectKey: string): Promise<number> {
  const id = 301
  const now = new Date().toISOString()
  const def: {
    id: number
    projectId: number
    name: string
    type: FieldType
    options: string[]
    position: number
    createdAt: string
    updatedAt: string
  } = { id, projectId: 1, name: '영향 범위', type: 'MULTI_SELECT', options: ['프론트엔드', '백엔드', LONG_OPTION], position: 0, createdAt: now, updatedAt: now }
  await page.route(`**/api/v1/projects/${projectKey}/fields`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([def]) }),
  )
  return id
}
