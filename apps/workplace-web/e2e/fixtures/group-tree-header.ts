// 연락처 사이드바 구역 머리(조직도·내 그룹) 기하 단언 — 데스크톱·모바일 시트 E2E 가 함께 쓴다(WP-1870 리뷰).
import type { Locator } from '@playwright/test'

import { expect } from './auth.fixture'

/**
 * 두 구역 머리 높이가 같고(관리자가 아니라 조직도 머리에 「＋」가 없어도), 「＋」 아이콘의 오른쪽 끝이
 * 머리 글자 여백 선(px-3 = 12px 안쪽)에 맞는지 본다. 단추가 32px·터치 44px 로 커져도 아이콘은 제자리여야 한다.
 */
export async function expectGroupHeadersAligned(scope: Locator, add: Locator, expectedHeight: number) {
  const orgHeader = scope.getByText('조직도', { exact: true }).locator('..')
  const groupHeader = add.locator('..')
  const org = (await orgHeader.boundingBox())!
  const group = (await groupHeader.boundingBox())!
  expect(Math.round(org.height)).toBe(expectedHeight)
  expect(Math.round(group.height)).toBe(expectedHeight)
  const icon = (await add.locator('svg').boundingBox())!
  expect(Math.abs(icon.x + icon.width - (group.x + group.width - 12))).toBeLessThanOrEqual(1.5)
}
