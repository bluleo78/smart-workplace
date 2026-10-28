// 이슈 검색 자리채움 규칙(WP-1049) — 같은 프로젝트 안에서 조건만 바뀌면 이전 결과를 두고, 다른 프로젝트로 옮기면 두지 않는다.
import { describe, expect, test } from 'vitest'

import type { IssueFilters } from '../../types/issue'
import { issueSearchKey, issueSearchOptions, keepPreviousInProject } from './useIssueSearch'

const previous = { pages: [{ items: [{ id: 1 }] }] }

describe('keepPreviousInProject', () => {
  test('같은 프로젝트의 다른 조건이면 이전 결과를 자리채움으로 돌려준다', () => {
    const keep = keepPreviousInProject<typeof previous>('WP')
    expect(keep(previous, { queryKey: ['issues', 'search', 'WP', { priorities: ['HIGH'] }, 30] })).toBe(previous)
  })

  test('다른 프로젝트의 결과는 남기지 않는다 — 그 프로젝트의 이슈가 잠깐이라도 보이면 안 된다', () => {
    const keep = keepPreviousInProject<typeof previous>('WP')
    expect(keep(previous, { queryKey: ['issues', 'search', 'OPS', {}, 30] })).toBeUndefined()
  })

  test('이전 쿼리가 없으면(처음 여는 화면) 자리채움이 없다', () => {
    const keep = keepPreviousInProject<typeof previous>('WP')
    expect(keep(undefined, undefined)).toBeUndefined()
  })

  test('실제 검색 키(issueSearchKey·issueSearchOptions)로도 프로젝트를 가린다 — 키 모양이 바뀌면 여기서 깨진다', () => {
    const keep = keepPreviousInProject<typeof previous>('WP')
    expect(keep(previous, { queryKey: issueSearchKey('WP', {} as IssueFilters, 30) })).toBe(previous)
    expect(keep(previous, { queryKey: issueSearchOptions('WP', {} as IssueFilters, 30, true, { sort: 'x' }).queryKey })).toBe(previous)
    expect(keep(previous, { queryKey: issueSearchKey('OTHER', {} as IssueFilters, 30) })).toBeUndefined()
  })
})
