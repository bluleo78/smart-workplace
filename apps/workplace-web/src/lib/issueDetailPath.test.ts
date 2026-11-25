// 이슈 상세 주소 판정 단위 테스트(WP-2074).
import { describe, expect, it } from 'vitest'

import { matchIssueDetailPath } from './issueDetailPath'

describe('matchIssueDetailPath', () => {
  it('이슈 상세 주소에서 프로젝트 키와 번호를 뽑는다', () => {
    expect(matchIssueDetailPath('/projects/WP/issues/12')).toEqual({ projectKey: 'WP', number: 12 })
    expect(matchIssueDetailPath('/projects/WP/issues/12/')).toEqual({ projectKey: 'WP', number: 12 })
    expect(matchIssueDetailPath('/projects/W%20P/issues/3')).toEqual({ projectKey: 'W P', number: 3 })
  })

  it('깨진 인코딩이나 이슈 상세가 아닌 주소는 null', () => {
    expect(matchIssueDetailPath('/projects/%E0%A4%A/issues/3')).toBeNull()
    expect(matchIssueDetailPath('/projects/WP/issues/abc')).toBeNull()
    expect(matchIssueDetailPath('/projects/WP/issues/0')).toBeNull()
    expect(matchIssueDetailPath('/projects/WP/issues/012')).toBeNull()
    expect(matchIssueDetailPath('/projects/WP/issues/12/edit')).toBeNull()
    expect(matchIssueDetailPath('/projects/WP')).toBeNull()
  })
})
