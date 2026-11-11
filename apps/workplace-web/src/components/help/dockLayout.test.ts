// 오른쪽 도킹 배치 판정(WP-1505) — 도움말·AI 옆 패널이 함께 열렸을 때 본문이 640px 보다 좁아지면 위아래로 합친다.
// 실측 본문 폭이 아니라 컨테이너 − 레일 − 패널 폭 계산이라 전환이 되먹임으로 깜빡이지 않는다(계획 「내가 정한 것」 1).
import { describe, expect, it } from 'vitest'

import { HELP_STACK_MIN_MAIN, isDockStacked } from './dockLayout'

const base = { railWidth: 56, helpWidth: 360, aiWidth: 380 }

describe('isDockStacked', () => {
  it('하나만 열렸거나 둘 다 닫히면 합치지 않는다(좁아도)', () => {
    expect(isDockStacked({ ...base, containerWidth: 1280, helpOpen: false, aiSide: false })).toBe(false)
    expect(isDockStacked({ ...base, containerWidth: 1280, helpOpen: true, aiSide: false })).toBe(false)
    expect(isDockStacked({ ...base, containerWidth: 1280, helpOpen: false, aiSide: true })).toBe(false)
  })

  it('둘 다 열렸고 넓으면 나란히', () => {
    expect(isDockStacked({ ...base, containerWidth: 1920, helpOpen: true, aiSide: true })).toBe(false)
  })

  it('본문이 640 보다 좁아지면 위아래', () => {
    expect(isDockStacked({ ...base, containerWidth: 1280, helpOpen: true, aiSide: true })).toBe(true)
    expect(isDockStacked({ ...base, containerWidth: 1435, helpOpen: true, aiSide: true })).toBe(true)
  })

  it('경계 — 본문 정확히 640 은 나란히', () => {
    expect(HELP_STACK_MIN_MAIN).toBe(640)
    expect(isDockStacked({ ...base, containerWidth: 1436, helpOpen: true, aiSide: true })).toBe(false)
  })

  it('레일을 펼치면 그만큼 본문이 줄어 위아래가 된다', () => {
    expect(isDockStacked({ ...base, railWidth: 152, containerWidth: 1500, helpOpen: true, aiSide: true })).toBe(true)
  })
})
