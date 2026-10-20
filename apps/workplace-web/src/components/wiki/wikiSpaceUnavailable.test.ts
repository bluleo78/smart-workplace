// isWikiSpaceUnavailable(WP-559) — 내 공간 목록에 없는 공간 주소를 볼 수 없음으로 판정하는지.
import { describe, expect, it } from 'vitest'

import type { WikiSpace } from '../../types/wiki'
import { canEditWikiSpace, isWikiSpaceUnavailable } from './wikiSpaceUnavailable'

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

// WP-602 — VIEWER 에게는 페이지 만들기·삭제·이동을 보여 주지 않는다.
describe('canEditWikiSpace', () => {
  const withRole = (id: number, role: WikiSpace['role']) => ({ ...space(id), role }) as WikiSpace
  const spaces = [withRole(1, 'OWNER'), withRole(2, 'EDITOR'), withRole(3, 'VIEWER')]
  it('OWNER·EDITOR 는 참', () => {
    expect(canEditWikiSpace(spaces, 1)).toBe(true)
    expect(canEditWikiSpace(spaces, 2)).toBe(true)
  })
  it('VIEWER 는 거짓', () => {
    expect(canEditWikiSpace(spaces, 3)).toBe(false)
  })
  it('목록이 없거나 목록에 없는 공간이면 거짓(fail-closed)', () => {
    expect(canEditWikiSpace(undefined, 1)).toBe(false)
    expect(canEditWikiSpace(spaces, 99)).toBe(false)
    expect(canEditWikiSpace(spaces, null)).toBe(false)
  })
})
