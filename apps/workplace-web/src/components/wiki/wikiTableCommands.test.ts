// 표 명령 가드 단위 테스트 — 에디터 없이 순수 스냅샷만으로 판정되는지 확인한다.
// 헤더 행 삭제와 마지막 열 삭제는 마크다운 직렬화를 깨뜨리므로 반드시 막혀야 한다.
import { describe, expect, it } from 'vitest'

import {
  isTableCommandEnabled,
  WIKI_TABLE_COMMANDS,
  type WikiTableSnapshot,
} from './wikiTableCommands'

const inBody: WikiTableSnapshot = { inTable: true, inHeaderRow: false, columnCount: 3, rowCount: 3 }
const inHeader: WikiTableSnapshot = { inTable: true, inHeaderRow: true, columnCount: 3, rowCount: 3 }
const outside: WikiTableSnapshot = { inTable: false, inHeaderRow: false, columnCount: 0, rowCount: 0 }

describe('isTableCommandEnabled', () => {
  it('표 밖에서는 모든 명령이 비활성', () => {
    for (const c of WIKI_TABLE_COMMANDS) {
      expect(isTableCommandEnabled(c.key, outside)).toBe(false)
    }
  })

  it('본문 행에서는 모든 명령이 활성', () => {
    for (const c of WIKI_TABLE_COMMANDS) {
      expect(isTableCommandEnabled(c.key, inBody)).toBe(true)
    }
  })

  it('헤더 행에서는 행 삭제만 비활성 — 헤더가 사라지면 GFM 표로 저장되지 않는다', () => {
    expect(isTableCommandEnabled('deleteRow', inHeader)).toBe(false)
    expect(isTableCommandEnabled('addRowAfter', inHeader)).toBe(true)
    expect(isTableCommandEnabled('deleteTable', inHeader)).toBe(true)
  })

  it('열이 1개면 열 삭제 비활성 — 빈 표가 남는 것을 막는다', () => {
    const oneCol: WikiTableSnapshot = { ...inBody, columnCount: 1 }
    expect(isTableCommandEnabled('deleteColumn', oneCol)).toBe(false)
    expect(isTableCommandEnabled('addColumnAfter', oneCol)).toBe(true)
  })

  it('헤더 행만 남은 표에서도 행 추가는 가능', () => {
    const headerOnly: WikiTableSnapshot = { inTable: true, inHeaderRow: true, columnCount: 2, rowCount: 1 }
    expect(isTableCommandEnabled('addRowAfter', headerOnly)).toBe(true)
    expect(isTableCommandEnabled('deleteRow', headerOnly)).toBe(false)
  })

  it('명령 목록에 직렬화 불가 명령이 섞여 있지 않다', () => {
    const keys = WIKI_TABLE_COMMANDS.map((c) => c.key)
    expect(keys).toEqual([
      'addRowBefore',
      'addRowAfter',
      'addColumnBefore',
      'addColumnAfter',
      'deleteRow',
      'deleteColumn',
      'deleteTable',
    ])
  })
})
