// 노트 공간 선택 상자 묶음(WP-1480 A안) — 개인/팀/프로젝트 나누기, 프로젝트 이름 순, 빈 묶음 숨김, 연결 후보 판정.
import { describe, expect, test } from 'vitest'

import { wikiSpace } from '../../e2e/factories/wiki.factory'
import { groupWikiSpaces, isProjectWikiSpace, linkableTeamSpaces } from './wikiSpaceGroups'

const mine = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' })
const product = wikiSpace({ id: 2, name: '제품팀', role: 'OWNER' })
const genia = wikiSpace({ id: 3, name: 'Gen:iA Works', role: 'EDITOR' })
const mobile = wikiSpace({ id: 4, name: '모바일 앱', projectKey: 'MOB', role: 'OWNER' })
const wp = wikiSpace({ id: 5, name: 'Gen:iA Works 프로젝트', projectKey: 'WP', role: 'EDITOR' })

describe('groupWikiSpaces', () => {
  test('개인 / 팀 / 프로젝트 순으로 나누고, 프로젝트는 이름 순, 팀은 서버 순서를 그대로 둔다', () => {
    const groups = groupWikiSpaces([mobile, product, mine, wp, genia])
    expect(groups.map((g) => [g.label, g.spaces.map((s) => s.id)])).toEqual([
      ['개인', [1]],
      ['팀', [2, 3]],
      // 한국어 정렬 — 한글 이름(모바일 앱)이 로마자 이름(Gen:iA …)보다 앞선다.
      ['프로젝트', [4, 5]],
    ])
  })

  test('projectKey 가 null 인 TEAM 공간은 팀으로 간다', () => {
    const groups = groupWikiSpaces([wikiSpace({ id: 9, projectKey: null })])
    expect(groups).toEqual([{ kind: 'team', label: '팀', spaces: [expect.objectContaining({ id: 9 })] }])
  })

  test('비어 있는 묶음은 결과에서 빠진다', () => {
    expect(groupWikiSpaces([mine, mobile]).map((g) => g.kind)).toEqual(['personal', 'project'])
    expect(groupWikiSpaces([])).toEqual([])
  })
})

describe('isProjectWikiSpace', () => {
  test('projectKey 가 있을 때만 프로젝트 공간이다', () => {
    expect(isProjectWikiSpace(mobile)).toBe(true)
    expect(isProjectWikiSpace(product)).toBe(false)
    expect(isProjectWikiSpace(wikiSpace({ projectKey: null }))).toBe(false)
    expect(isProjectWikiSpace(null)).toBe(false)
  })
})

describe('linkableTeamSpaces', () => {
  test('내가 OWNER 인, 연결 안 된 TEAM 공간만 이름 순으로 고른다', () => {
    const other = wikiSpace({ id: 6, name: '가나팀', role: 'OWNER' })
    expect(linkableTeamSpaces([mine, product, genia, mobile, other]).map((s) => s.id)).toEqual([6, 2])
  })
})
