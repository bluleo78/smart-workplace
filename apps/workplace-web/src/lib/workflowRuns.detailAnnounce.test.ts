// 실행 상세·내 차례 상세가 열렸을 때 스크린리더에 읽힐 문구(WP-2053).
import { expect, it } from 'vitest'

import { runDetailOpenedText, turnDetailOpenedText } from './workflowRuns'

it('runDetailOpenedText_includesIssueKey', () => {
  expect(runDetailOpenedText('WP-1')).toBe('WP-1 실행 상세를 열었습니다')
})

it('turnDetailOpenedText_includesIssueKey', () => {
  expect(turnDetailOpenedText('WP-10')).toBe('WP-10 내 차례 상세를 열었습니다')
})
