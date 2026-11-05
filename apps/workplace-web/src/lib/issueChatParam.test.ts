// 이슈 채팅 딥링크 쿼리 지우기(WP-1374) — 개인 작업 모바일 딥링크 소비·데스크톱 없는 작업 정리가 함께 쓰는 replace 이동.
import { describe, expect, it, vi } from 'vitest'

import { markKey } from './historyParam'
import { removeIssueChatParam } from './issueChatParam'

describe('removeIssueChatParam', () => {
  it('chat 만 지우고 경로·다른 쿼리·hash·router state 는 보존해 replace 한다 — chat 열림 마크만 함께 뺀다', () => {
    const navigate = vi.fn()
    removeIssueChatParam(navigate, {
      pathname: '/projects/PME',
      search: '?view=board&task=1&chat=1',
      hash: '#x',
      state: { [markKey('task')]: 2, [markKey('chat')]: 3, keep: 1 },
    })
    expect(navigate).toHaveBeenCalledWith(
      { pathname: '/projects/PME', search: '?view=board&task=1', hash: '#x' },
      { replace: true, state: { [markKey('task')]: 2, keep: 1 } },
    )
  })

  it('chat 하나뿐이면 쿼리를 비우고(? 없음) 남는 state 가 없으면 null', () => {
    const navigate = vi.fn()
    removeIssueChatParam(navigate, { pathname: '/p', search: '?chat=1', hash: '', state: null })
    expect(navigate).toHaveBeenCalledWith({ pathname: '/p', search: '', hash: '' }, { replace: true, state: null })
  })
})
