// isWikiSpaceUnavailable(WP-559) — 내 공간 목록에 없는 공간 주소를 볼 수 없음으로 판정하는지.
import { describe, expect, it } from 'vitest'

import type { WikiSpace } from '../../types/wiki'
import { isWikiSpaceUnavailable } from './wikiSpaceUnavailable'

const space = (id: number) => ({ id, name: `공간 ${id}`, type: 'TEAM' }) as WikiSpace
const ready = (data: WikiSpace[]) => ({ data, isSuccess: true, isFetching: false })

describe('isWikiSpaceUnavailable', () => {
  it('목록에 없는 공간은 볼 수 없음', () => {
    expect(isWikiSpaceUnavailable(ready([space(1), space(2)]), 8)).toBe(true)
  })
  it('목록에 있는 공간은 볼 수 있음', () => {
    expect(isWikiSpaceUnavailable(ready([space(1), space(8)]), 8)).toBe(false)
  })
  it('목록을 불러오거나 다시 불러오는 중에는 판정하지 않는다', () => {
    expect(isWikiSpaceUnavailable({ data: undefined, isSuccess: false, isFetching: true }, 8)).toBe(false)
    expect(isWikiSpaceUnavailable({ data: [space(1)], isSuccess: true, isFetching: true }, 8)).toBe(false)
  })
  it('공간 주소가 아니면 판정하지 않는다', () => {
    expect(isWikiSpaceUnavailable(ready([space(1)]), null)).toBe(false)
  })
})
