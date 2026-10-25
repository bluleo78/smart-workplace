import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MailServerFolder } from '@/types/mailFolder'

import {
  buildMailFolderTree,
  collapsedStorageKey,
  folderAncestorIds,
  folderIndentPx,
  folderNamePath,
  folderRangeDays,
  MAX_INDENT_DEPTH,
  readCollapsed,
  visibleFolderRows,
  writeCollapsed,
} from './mailFolders'

/** 서버 메일함 한 개(기본: 열 수 있는 USER 최상위). */
const f = (o: Partial<MailServerFolder> & { id: number }): MailServerFolder => ({
  displayName: `메일함${o.id}`, parentId: null, role: 'USER', selectable: true, unreadCount: 0, totalCount: 0,
  syncedSince: null, folderSyncedAt: null, ...o,
})
const ids = (rows: { folder: MailServerFolder }[]) => rows.map((r) => r.folder.id)

describe('buildMailFolderTree', () => {
  it('보관은 따로, USER 는 parentId 로 계층', () => {
    const { archive, tree } = buildMailFolderTree([
      f({ id: 1, role: 'ARCHIVE' }), f({ id: 2 }), f({ id: 3, parentId: 2 }), f({ id: 4, parentId: 3 }), f({ id: 5 }),
    ])
    expect(archive?.id).toBe(1)
    expect(tree.map((n) => n.folder.id)).toEqual([2, 5])
    expect(tree[0].children[0].folder.id).toBe(3)
    expect(tree[0].children[0].children[0].folder.id).toBe(4)
  })
  it('형제는 한국어 이름순(숫자는 크기순) — 서버 순서와 상관없이', () => {
    const { tree } = buildMailFolderTree([
      f({ id: 1, displayName: '출장' }), f({ id: 2, displayName: '세금계산서' }), f({ id: 3, displayName: 'A사 프로젝트' }),
      f({ id: 4, displayName: '10월', parentId: 2 }), f({ id: 5, displayName: '2월', parentId: 2 }),
    ])
    expect(tree.map((n) => n.folder.displayName)).toEqual(['세금계산서', '출장', 'A사 프로젝트'])
    expect(tree[0].children.map((n) => n.folder.displayName)).toEqual(['2월', '10월'])
  })
  it('부모가 목록에 없거나 보관이면 최상위로 올린다', () => {
    const { tree } = buildMailFolderTree([f({ id: 1, role: 'ARCHIVE' }), f({ id: 2, parentId: 99 }), f({ id: 3, parentId: 1 })])
    expect(tree.map((n) => n.folder.id)).toEqual([2, 3])
  })
  it('보관이 없으면 null, 빈 목록이면 빈 트리', () => {
    expect(buildMailFolderTree([])).toEqual({ archive: null, tree: [] })
  })
  it('selectable=false 잎은 빼고, 하위가 있으면 묶음 노드로 남긴다', () => {
    const { tree } = buildMailFolderTree([f({ id: 2, selectable: false }), f({ id: 3, selectable: false }), f({ id: 4, parentId: 3 })])
    expect(tree.map((n) => n.folder.id)).toEqual([3])
    expect(tree[0].children.map((n) => n.folder.id)).toEqual([4])
  })
  it('부모 고리(A↔B)·자기 부모여도 각 메일함은 한 번만', () => {
    const { tree } = buildMailFolderTree([f({ id: 2, parentId: 3 }), f({ id: 3, parentId: 2 }), f({ id: 4, parentId: 4 })])
    const all = visibleFolderRows(tree, new Set())
    expect(ids(all).sort()).toEqual([2, 3, 4])
  })
})

describe('visibleFolderRows', () => {
  const { tree } = buildMailFolderTree([f({ id: 2 }), f({ id: 3, parentId: 2 }), f({ id: 4, parentId: 3 }), f({ id: 5 })])
  it('기본 펼침 — 깊이·하위 여부', () => {
    expect(visibleFolderRows(tree, new Set()).map((r) => [r.folder.id, r.depth, r.hasChildren, r.expanded])).toEqual([
      [2, 0, true, true], [3, 1, true, true], [4, 2, false, false], [5, 0, false, false],
    ])
  })
  it('접은 메일함의 하위는 숨긴다', () => {
    expect(ids(visibleFolderRows(tree, new Set([2])))).toEqual([2, 5])
    expect(ids(visibleFolderRows(tree, new Set([3])))).toEqual([2, 3, 5])
  })
})

describe('경로·조상·들여쓰기·기간', () => {
  const list = [f({ id: 1, role: 'ARCHIVE', displayName: 'Archive' }), f({ id: 2, displayName: '회사' }), f({ id: 3, parentId: 2, displayName: '견적' })]
  it('folderNamePath — 최상위부터, 보관은 「보관」, 없으면 빈 배열', () => {
    expect(folderNamePath(list, 3)).toEqual(['회사', '견적'])
    expect(folderNamePath(list, 1)).toEqual(['보관'])
    expect(folderNamePath(list, 99)).toEqual([])
  })
  it('folderAncestorIds — 가까운 순, 고리에서 멈춤', () => {
    expect(folderAncestorIds(list, 3)).toEqual([2])
    expect(folderAncestorIds([f({ id: 2, parentId: 3 }), f({ id: 3, parentId: 2 })], 2)).toEqual([3])
  })
  it('들여쓰기는 상한 깊이에서 멈춘다', () => {
    expect(folderIndentPx(1)).toBeGreaterThan(folderIndentPx(0))
    expect(folderIndentPx(MAX_INDENT_DEPTH + 5)).toBe(folderIndentPx(MAX_INDENT_DEPTH))
  })
  it('folderRangeDays — 가져온 시각 - 경계(일), 없으면 null', () => {
    expect(folderRangeDays({ syncedSince: '2026-07-27T00:00:00Z', folderSyncedAt: '2026-10-25T00:00:00Z' })).toBe(90)
    expect(folderRangeDays({ syncedSince: null, folderSyncedAt: '2026-10-25T00:00:00Z' })).toBeNull()
    expect(folderRangeDays({ syncedSince: '2026-10-26T00:00:00Z', folderSyncedAt: '2026-10-25T00:00:00Z' })).toBeNull()
  })
})

describe('접힘 저장', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('계정별로 쓰고 읽는다, 깨진 값·저장소 오류는 빈 집합', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    writeCollapsed(7, new Set([3, 4]))
    expect([...readCollapsed(7)]).toEqual([3, 4])
    expect(readCollapsed(8).size).toBe(0)
    store.set(collapsedStorageKey(9), '{broken')
    expect(readCollapsed(9).size).toBe(0)
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    expect(readCollapsed(7).size).toBe(0)
    expect(() => writeCollapsed(7, new Set([1]))).not.toThrow()
  })
})
