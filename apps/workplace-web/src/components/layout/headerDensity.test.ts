// 단계 순서와 실측 접기 이동량에 따른 복귀 경계를 검증한다.
// WP-1611: 마지막 단계(헤더 넣기, docked)의 진입 순서·이력(160 미만 진입, 200 초과 해제)·헤더 자리 없는 화면도 본다.
import { describe, expect, it } from 'vitest'

import { type HeaderDensityState, nextHeaderDensityState } from './headerDensity'

/** 테스트용 상태 — 생략한 단계는 꺼져 있다. */
const state = (partial: Partial<HeaderDensityState> = {}): HeaderDensityState => ({ folded: false, circle: false, docked: false, ...partial })

describe('nextHeaderDensityState', () => {
  it('검색 전용은 동그라미를 켜지 않고 접기 복귀 경계를 적용한다', () => {
    expect(nextHeaderDensityState({ titleSpace: 100, hasAuxiliaryActions: true, hasAiChip: false, current: state({ folded: true }), foldDisplacement: 50 })).toEqual(state({ folded: true }))
    expect(nextHeaderDensityState({ titleSpace: 220, hasAuxiliaryActions: true, hasAiChip: false, current: state({ folded: true, circle: true }), foldDisplacement: 50 })).toEqual(state())
  })

  it.each([
    [159, true, false, false, 250, true, false],
    [159, true, true, false, 250, true, true],
    [410, true, true, false, 250, true, false],
    [411, true, true, false, 250, false, false],
    [268, true, true, true, 250, true, true],
    [269, true, true, true, 250, true, false],
    [159, false, false, false, 0, false, true],
    [269, false, false, true, 0, false, false],
    [160, true, false, false, 250, false, false],
  ])('공간 %ipx, 보조 %s, 접힘 %s, 동그라미 %s, 이동 %ipx → %s/%s',
    (titleSpace, hasAuxiliaryActions, folded, circle, foldDisplacement, nextFolded, nextCircle) => {
      expect(nextHeaderDensityState({ titleSpace, hasAuxiliaryActions, current: state({ folded, circle }), foldDisplacement }))
        .toEqual(state({ folded: nextFolded, circle: nextCircle }))
    })
})

describe('nextHeaderDensityState — 헤더 넣기(docked, WP-1611)', () => {
  /** 헤더 자리가 있는 화면에서 같은 제목 자리로 한 측정씩 다음 상태를 구한다. */
  const step = (titleSpace: number, current: HeaderDensityState, opts: { aux?: boolean; ai?: boolean; dock?: boolean } = {}) =>
    nextHeaderDensityState({
      titleSpace,
      hasAuxiliaryActions: opts.aux ?? true,
      hasAiChip: opts.ai ?? true,
      hasDockSlot: opts.dock ?? true,
      current,
      foldDisplacement: 250,
    })

  it('계속 좁으면 접기 → 동그라미 → 헤더 넣기 순서로 한 단계씩 나아간다', () => {
    const first = step(100, state())
    expect(first).toEqual(state({ folded: true }))
    const second = step(100, first)
    expect(second).toEqual(state({ folded: true, circle: true }))
    const third = step(100, second)
    expect(third).toEqual(state({ folded: true, circle: true, docked: true }))
    // 헤더에 넣은 뒤에도 좁으면 그대로 머문다.
    expect(step(100, third)).toEqual(third)
  })

  it('비서가 없으면 동그라미 단계를 건너뛰고 접기 다음에 헤더로 넣는다', () => {
    const first = step(100, state(), { ai: false })
    expect(first).toEqual(state({ folded: true }))
    expect(step(100, first, { ai: false })).toEqual(state({ folded: true, docked: true }))
  })

  it('보조 액션도 비서도 없으면 첫 측정에서 바로 헤더로 넣는다', () => {
    expect(step(100, state(), { aux: false, ai: false })).toEqual(state({ docked: true }))
  })

  it('보조 액션이 없고 비서가 있으면 동그라미 다음에 헤더로 넣는다', () => {
    const first = step(100, state(), { aux: false })
    expect(first).toEqual(state({ circle: true }))
    expect(step(100, first, { aux: false })).toEqual(state({ circle: true, docked: true }))
  })

  it('앞 단계를 다 썼어도 제목 자리가 160px 이상이면 헤더로 넣지 않는다', () => {
    expect(step(160, state({ folded: true, circle: true }))).toEqual(state({ folded: true, circle: true }))
  })

  it('헤더 자리가 없는 화면은 앞 단계를 다 써도 떠 있는 틀을 유지한다', () => {
    expect(step(50, state({ folded: true, circle: true }), { dock: false })).toEqual(state({ folded: true, circle: true }))
    // 이미 넣은 상태에서 헤더 자리가 사라지면 곧바로 푼다.
    expect(step(50, state({ folded: true, circle: true, docked: true }), { dock: false })).toEqual(state({ folded: true, circle: true }))
  })

  it.each([
    [159, true],
    [160, true],
    [200, true],
    [201, false],
  ])('헤더에 넣은 동안 제목 자리 %ipx → 유지 %s (160 + 여유 40px 를 넘어야 돌아간다)', (titleSpace, stays) => {
    const docked = state({ folded: true, circle: true, docked: true })
    expect(step(titleSpace, docked)).toEqual(stays ? docked : state({ folded: true, circle: true }))
  })

  it('가운데로 돌아간 뒤에는 동그라미·접기가 기존 규칙으로 차례로 풀린다', () => {
    const undocked = step(300, state({ folded: true, circle: true, docked: true }))
    expect(undocked).toEqual(state({ folded: true, circle: true }))
    const uncircled = step(300, undocked)
    expect(uncircled).toEqual(state({ folded: true }))
    expect(step(450, uncircled)).toEqual(state())
  })

  it('돌아간 직후 이력 구간(160~200px)에서는 다시 헤더로 들어가지 않는다', () => {
    const undocked = step(201, state({ folded: true, circle: true, docked: true }))
    expect(undocked.docked).toBe(false)
    expect(step(170, undocked).docked).toBe(false)
  })
})
