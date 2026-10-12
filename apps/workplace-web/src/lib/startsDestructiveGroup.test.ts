// 행 작업 메뉴 구분선 규칙(WP-363) 단위 테스트 — 일반 항목 다음 첫 파괴적 항목 앞에만 구분선.
import { describe, expect, it } from 'vitest'

import { startsDestructiveGroup } from './startsDestructiveGroup'

const act = (key: string, destructive = false) => ({ key, destructive })
const separatorsBefore = (actions: { key: string; destructive: boolean }[]) =>
  actions.filter((_, i) => startsDestructiveGroup(actions, i)).map((a) => a.key)

describe('startsDestructiveGroup', () => {
  it('일반 항목 뒤의 삭제 앞에만 구분선을 둔다', () => {
    expect(separatorsBefore([act('rename'), act('copy'), act('delete', true)])).toEqual(['delete'])
  })

  it('파괴적 항목이 이어지면 첫 항목 앞에만 둔다', () => {
    expect(separatorsBefore([act('edit'), act('remove', true), act('purge', true)])).toEqual(['remove'])
  })

  it('파괴적 항목뿐이거나 맨 앞이면 구분선을 두지 않는다', () => {
    expect(separatorsBefore([act('delete', true)])).toEqual([])
    expect(separatorsBefore([act('delete', true), act('rename')])).toEqual([])
  })

  it('파괴적 항목이 없으면 구분선이 없다', () => {
    expect(separatorsBefore([act('download'), act('share')])).toEqual([])
  })
})
