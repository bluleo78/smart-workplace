// 이슈 관계 화면 로직(WP-887) — 「이 이슈는…」 선택지, 외부 주소의 키 뽑기, 레일 묶음 순서, 표시 키.
import { describe, expect, it } from 'vitest'

import type { IssueLinkSummary, IssueRelationSide, IssueRelationType, IssueRelationView } from '../types/issue'
import {
  displayRelationLabel,
  extractKeyFromUrl,
  groupRelations,
  relatedIssueKey,
  relationOptions,
  relationTypeMoveTargets,
  relationTypeUsage,
} from './issueRelations'

/** 기본 유형 6종 — 서버 시드(V208)와 같은 말·정렬. */
function builtInTypes(): IssueRelationType[] {
  const t = (
    id: number,
    code: string,
    name: string,
    directed: boolean,
    outwardLabel: string,
    inwardLabel: string | null,
    sortOrder: number,
    externalOnly = false,
  ): IssueRelationType => ({ id, code, name, directed, outwardLabel, inwardLabel, externalOnly, hidden: false, sortOrder })
  return [
    // 일부러 정렬 순과 다르게 섞어 둔다 — 함수가 sortOrder 로 정렬하는지 본다.
    t(3, 'DUPLICATES', '중복', true, '중복임', '원본임', 30),
    t(1, 'BLOCKS', '차단', true, '차단 중', '차단됨', 10),
    t(2, 'RELATES', '관련', false, '관련', null, 20),
    t(4, 'CLONES', '복제', true, '복제본임', '복제 원본임', 40),
    t(5, 'CAUSES', '원인', true, '원인임', '결과임', 50),
    t(6, 'PARENT_EPIC', '상위 에픽', true, '에픽에 속함', null, 60, true),
  ]
}

const type = { id: 1, name: 'TASK', colorToken: 'BLUE', icon: 'Circle' } as const

function link(number: number): IssueLinkSummary {
  return { number, title: `이슈 ${number}`, status: 'TODO', type, dueDate: null }
}

function relation(
  id: number,
  typeId: number,
  label: string,
  side: IssueRelationSide = 'source',
  projectKey = 'WP',
  number = 100 + id,
): IssueRelationView {
  return { id, typeId, typeCode: null, label, side, issue: { projectKey, number, title: `상대 ${number}`, status: 'TODO', type } }
}

describe('relationOptions', () => {
  it('기본 유형은 정렬 순으로, 방향 있는 유형은 A 쪽·B 쪽 두 선택지를 낸다(차단됨은 「(선행 필요)」를 붙인다)', () => {
    const options = relationOptions(builtInTypes())
    expect(options.filter((o) => !o.externalOnly).map((o) => o.label)).toEqual([
      '차단 중',
      '차단됨 (선행 필요)',
      '관련',
      '중복임',
      '원본임',
      '복제본임',
      '복제 원본임',
      '원인임',
      '결과임',
    ])
    // 외부 링크 탭은 외부 전용 유형(에픽에 속함)까지.
    expect(options.map((o) => o.label).at(-1)).toBe('에픽에 속함')
    expect(options).toHaveLength(10)
  })

  it('A 쪽은 source, B 쪽은 target, 방향 없는 유형은 source 하나', () => {
    const options = relationOptions(builtInTypes())
    expect(options.find((o) => o.label === '원본임')).toMatchObject({ typeId: 3, side: 'target', typeCode: 'DUPLICATES' })
    expect(options.find((o) => o.label === '중복임')).toMatchObject({ typeId: 3, side: 'source' })
    expect(options.filter((o) => o.typeId === 2)).toEqual([
      { typeId: 2, side: 'source', label: '관련', typeCode: 'RELATES', externalOnly: false },
    ])
  })

  it('숨긴 유형은 선택지에 없다', () => {
    const types = builtInTypes().map((t) => (t.code === 'CLONES' ? { ...t, hidden: true } : t))
    expect(relationOptions(types).map((o) => o.label)).not.toContain('복제본임')
    expect(relationOptions(types).map((o) => o.label)).not.toContain('복제 원본임')
  })

  it('고치는 링크의 숨긴 유형은 그 쪽 선택지 하나만 남긴다', () => {
    const types = builtInTypes().map((t) => (t.code === 'CLONES' ? { ...t, hidden: true } : t))
    const labels = relationOptions(types, { typeId: 4, side: 'target' }).map((o) => o.label)
    expect(labels).toContain('복제 원본임')
    expect(labels).not.toContain('복제본임')
  })
})

describe('extractKeyFromUrl', () => {
  it('Jira …/browse/KEY-n 주소에서 키를 뽑는다', () => {
    expect(extractKeyFromUrl('https://iacloud.atlassian.net/browse/CL-1867')).toBe('CL-1867')
    expect(extractKeyFromUrl('https://iacloud.atlassian.net/browse/TECH_2-41?focusedCommentId=1')).toBe('TECH_2-41')
  })

  it('경로 끝이 키 꼴이거나 selectedIssue 쿼리가 있으면 그 키', () => {
    expect(extractKeyFromUrl('https://tracker.example.com/issues/INFRA-5')).toBe('INFRA-5')
    expect(extractKeyFromUrl('https://iacloud.atlassian.net/jira/software/projects/CL/boards/1?selectedIssue=CL-12')).toBe('CL-12')
  })

  it('키가 없거나 주소가 아니면 null', () => {
    expect(extractKeyFromUrl('https://example.com/a')).toBeNull()
    expect(extractKeyFromUrl('not a url')).toBeNull()
    expect(extractKeyFromUrl('')).toBeNull()
  })
})

describe('groupRelations', () => {
  it('비어 있는 묶음은 빼고 차단됨 → 차단 중 → 유형 정렬 순(같은 유형은 A 쪽 먼저)', () => {
    const groups = groupRelations(
      [link(7)],
      [],
      [relation(1, 5, '결과임', 'target'), relation(2, 2, '관련'), relation(3, 5, '원인임'), relation(4, 2, '관련', 'source', 'WPV', 28)],
      builtInTypes(),
    )
    expect(groups.map((g) => g.label)).toEqual(['차단됨 (선행 필요)', '관련', '원인임', '결과임'])
    // 묶음 식별자는 유형 id + 이 이슈 쪽(한글 말이 아니라) — testid 로 쓴다.
    expect(groups.map((g) => g.key)).toEqual(['blockedBy', '2-source', '5-source', '5-target'])
    // 목록 testid — 차단은 기존 계약, 관계는 묶음 식별자로.
    expect(groups.map((g) => g.testId)).toEqual([
      'blocked-by-list',
      'issue-relation-group-2-source',
      'issue-relation-group-5-source',
      'issue-relation-group-5-target',
    ])
    expect(groups[0].rows).toEqual([{ kind: 'blocking', direction: 'blockedBy', link: link(7) }])
    // 같은 말 묶음엔 줄이 모인다.
    expect(groups[1].rows.map((r) => (r.kind === 'relation' ? r.relation.id : null))).toEqual([2, 4])
  })

  it('차단만 있으면 차단됨 → 차단 중 두 묶음, 전부 비면 빈 배열', () => {
    expect(groupRelations([link(1)], [link(2)], []).map((g) => g.testId)).toEqual(['blocked-by-list', 'blocks-list'])
    expect(groupRelations([], [], [])).toEqual([])
  })

  it('유형 목록이 없으면 유형 id 순으로 둔다(기본 유형이 먼저 만들어져 id 가 작다)', () => {
    const groups = groupRelations([], [], [relation(1, 9, '테스트 대상'), relation(2, 2, '관련')])
    expect(groups.map((g) => g.label)).toEqual(['관련', '테스트 대상'])
  })

  it('유형 목록이 없어도 서버가 준 side 로 묶는다 — A 쪽 묶음이 먼저', () => {
    const groups = groupRelations([], [], [
      relation(1, 5, '결과임', 'target'),
      relation(2, 5, '원인임', 'source'),
      relation(3, 5, '결과임', 'target'),
    ])
    expect(groups.map((g) => [g.key, g.label, g.rows.length])).toEqual([
      ['5-source', '원인임', 1],
      ['5-target', '결과임', 2],
    ])
  })
})

describe('displayRelationLabel / relatedIssueKey / relationTypeUsage', () => {
  it('차단 B 쪽 말만 「(선행 필요)」를 붙인다', () => {
    expect(displayRelationLabel('BLOCKS', '차단됨')).toBe('차단됨 (선행 필요)')
    expect(displayRelationLabel('BLOCKS', '차단 중')).toBe('차단 중')
    expect(displayRelationLabel(null, '차단됨')).toBe('차단됨')
  })

  it('같은 프로젝트는 #번호, 다른 프로젝트는 키', () => {
    expect(relatedIssueKey('WP', 'WP', 12)).toBe('#12')
    expect(relatedIssueKey('WPV', 'WP', 28)).toBe('WPV-28')
  })

  it('쓰이는 곳 수는 이슈 사이 관계 + 외부 링크', () => {
    expect(relationTypeUsage({ relationCount: 3, externalLinkCount: 2 })).toBe(5)
    expect(relationTypeUsage({ relationCount: 0, externalLinkCount: 0 })).toBe(0)
  })
})

describe('relationTypeMoveTargets', () => {
  it('자기 자신·차단·외부 전용·숨긴 유형은 옮길 곳이 아니다', () => {
    const custom: IssueRelationType = {
      id: 9, code: null, name: '테스트', directed: true, outwardLabel: '테스트 케이스', inwardLabel: '테스트 대상',
      externalOnly: false, hidden: false, sortOrder: 1000,
    }
    const types = [...builtInTypes().map((t) => (t.code === 'CLONES' ? { ...t, hidden: true } : t)), custom]
    expect(relationTypeMoveTargets(types, custom).map((t) => t.name)).toEqual(['중복', '관련', '원인'])
  })

  it('방향 없는 유형에서는 방향 있는 유형으로 옮길 수 없다', () => {
    const undirected: IssueRelationType = {
      id: 9, code: null, name: '그냥', directed: false, outwardLabel: '그냥', inwardLabel: null,
      externalOnly: false, hidden: false, sortOrder: 1000,
    }
    expect(relationTypeMoveTargets([...builtInTypes(), undirected], undirected).map((t) => t.name)).toEqual(['관련'])
  })
})
