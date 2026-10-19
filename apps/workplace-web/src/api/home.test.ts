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
})
