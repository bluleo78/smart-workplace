// meIssuesQueryParams(WP-518) — 이슈 목록 위젯 담당자 「전체」가 서버가 모르는 username 'all' 로 나가지 않게 한다.
import { describe, expect, it } from 'vitest'

import { meIssuesQueryParams } from './home'

describe('meIssuesQueryParams (WP-518)', () => {
  it('assignee=all 은 담당자 조건 없음으로 쿼리에서 빠지고 나머지 필터는 그대로 간다', () => {
    expect(meIssuesQueryParams({ assignee: 'all', priority: 'HIGH' })).toEqual({ priority: 'HIGH' })
    expect(meIssuesQueryParams({ assignee: 'ALL' })).toEqual({})
  })

  it('me·username 담당자는 그대로 보낸다', () => {
    expect(meIssuesQueryParams({ assignee: 'me', size: 50 })).toEqual({ assignee: 'me', size: '50' })
    expect(meIssuesQueryParams({ assignee: 'kim' })).toEqual({ assignee: 'kim' })
  })

  // WP-888: AI 목록 카드(show_issue_list)의 params 는 그대로 /me/issues 쿼리가 된다 — component 와 같이 fixVersion·affectsVersion 도 걸러내지 않는다.
  it('수정 버전·영향 버전 params 는 이름·id·none 그대로 쿼리에 실린다', () => {
    expect(meIssuesQueryParams({ assignee: 'me', fixVersion: '1.2, none', affectsVersion: [3, 4], component: 'Compute' })).toEqual({
      assignee: 'me',
      fixVersion: '1.2, none',
      affectsVersion: '3,4',
      component: 'Compute',
    })
  })
})
