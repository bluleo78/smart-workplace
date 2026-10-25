// 이슈 관계(WP-887) 모킹 팩토리 — 관계 유형 목록·관계 줄·외부 링크 줄.
import type { IssueExternalLinkView, IssueRelationType, IssueRelationView } from '../../src/types/issue'
import { makeTaskType } from './issueType.factory'

/** 기본 관계 유형 6종 — 서버 시드(V208)와 같은 이름·말·정렬. id 는 1~6. */
export function defaultRelationTypes(): IssueRelationType[] {
  const t = (
    id: number,
    code: string,
    name: string,
    directed: boolean,
    outwardLabel: string,
    inwardLabel: string | null,
    externalOnly = false,
  ): IssueRelationType => ({
    id, code, name, directed, outwardLabel, inwardLabel, externalOnly, hidden: false, sortOrder: id * 10,
  })
  return [
    t(1, 'BLOCKS', '차단', true, '차단 중', '차단됨'),
    t(2, 'RELATES', '관련', false, '관련', null),
    t(3, 'DUPLICATES', '중복', true, '중복임', '원본임'),
    t(4, 'CLONES', '복제', true, '복제본임', '복제 원본임'),
    t(5, 'CAUSES', '원인', true, '원인임', '결과임'),
    t(6, 'PARENT_EPIC', '상위 에픽', true, '에픽에 속함', null, true),
  ]
}

/** 이슈 상세의 관계 한 줄 — 기본은 같은 프로젝트(WP) #100 과 「관련」. */
export function createRelation(overrides: Partial<IssueRelationView> = {}): IssueRelationView {
  return {
    id: 1,
    typeId: 2,
    typeCode: 'RELATES',
    label: '관련',
    side: 'source',
    issue: { projectKey: 'WP', number: 100, title: '관련 이슈', status: 'TODO', type: makeTaskType() },
    ...overrides,
  }
}

/** 이슈 상세의 외부 링크 한 줄 — 기본은 Jira 에픽 소속. */
export function createExternalLink(overrides: Partial<IssueExternalLinkView> = {}): IssueExternalLinkView {
  return {
    id: 1,
    typeId: 6,
    typeCode: 'PARENT_EPIC',
    label: '에픽에 속함',
    side: 'source',
    url: 'https://iacloud.atlassian.net/browse/CL-1867',
    key: 'CL-1867',
    title: 'v1.7.0 버그 픽스 및 이슈 대응',
    ...overrides,
  }
}
