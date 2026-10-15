// 가상 키보드 열림 판정 단위 테스트(WP-412) — 이전 E2E mobile/keyboard 의 "키보드로 보지 않는" 세 경우를 옮겼다.
// 키보드가 열렸을 때 셸·다이얼로그·시트 배치(모바일 레이아웃)는 E2E 가 계속 지킨다.
import { describe, expect, it } from 'vitest'

import { detectKeyboard } from './useVisualViewport'

const BASE = 800

describe('detectKeyboard', () => {
  it('기준 높이보다 150px 넘게 줄고 편집 요소에 포커스가 있으면 열림', () => {
    expect(detectKeyboard({ height: BASE - 300, scale: 1 }, BASE, true)).toBe(true)
  })
  it('주소창 높이 변화 정도(임계값 이하)는 열림이 아니다', () => {
    expect(detectKeyboard({ height: BASE - 80, scale: 1 }, BASE, true)).toBe(false)
    expect(detectKeyboard({ height: BASE - 150, scale: 1 }, BASE, true)).toBe(false)
  })
  it('핀치 줌(배율≠1)으로 줄어든 것은 포커스가 있어도 열림이 아니다', () => {
    expect(detectKeyboard({ height: BASE - 300, scale: 1.5 }, BASE, true)).toBe(false)
  })
  it('편집 요소 포커스가 없으면 줄어도 열림이 아니다', () => {
    expect(detectKeyboard({ height: BASE - 300, scale: 1 }, BASE, false)).toBe(false)
  })
})
