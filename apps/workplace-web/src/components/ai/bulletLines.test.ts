import { describe, expect, it } from 'vitest'

import { bulletLines } from './bulletLines'

describe('bulletLines', () => {
  it('• 목록이면 기호를 뗀 항목 배열을 돌려준다(빈 줄 무시)', () => {
    expect(bulletLines('• 배포 확정\n\n• QA 는 수요일까지')).toEqual(['배포 확정', 'QA 는 수요일까지'])
  })

  it('목록이 아닌 줄이 하나라도 있으면 null — 원문을 그대로 보인다', () => {
    expect(bulletLines('배포를 확정했다. QA 는 수요일까지 마친다.')).toBeNull()
    expect(bulletLines('• 배포 확정\n덧붙임')).toBeNull()
  })

  it('빈 문자열은 null', () => {
    expect(bulletLines('')).toBeNull()
  })
})
