// 단계 순서와 실측 접기 이동량에 따른 복귀 경계를 검증한다.
import { describe, expect, it } from 'vitest'

import { nextHeaderDensityState } from './headerDensity'

describe('nextHeaderDensityState', () => {
  it('검색 전용은 동그라미를 켜지 않고 접기 복귀 경계를 적용한다', () => {
    expect(nextHeaderDensityState({ titleSpace: 100, hasAuxiliaryActions: true, hasAiChip: false, current: { folded: true, circle: false }, foldDisplacement: 50 })).toEqual({ folded: true, circle: false })
    expect(nextHeaderDensityState({ titleSpace: 220, hasAuxiliaryActions: true, hasAiChip: false, current: { folded: true, circle: true }, foldDisplacement: 50 })).toEqual({ folded: false, circle: false })
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
      expect(nextHeaderDensityState({ titleSpace, hasAuxiliaryActions, current: { folded, circle }, foldDisplacement }))
        .toEqual({ folded: nextFolded, circle: nextCircle })
    })
})
