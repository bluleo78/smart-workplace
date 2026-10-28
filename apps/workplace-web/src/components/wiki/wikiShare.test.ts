// 노트 공유 순수 판정(WP-579) — 넓히는 변경·트리 공유 표시·이동 영향·하위 수·만료·공유 창 권한.
// WP-1023 — 범위 요약의 부서 수, 내 그룹을 사람으로 펼치기와 안내 문구.
import { describe, expect, it } from 'vitest'

import type { WikiShareAudience, WikiTreeShare } from '../../types/wiki'
import {
  addGroupMembers,
  blockedShareNotice,
  canManageShare,
  countDescendants,
  countLivePublicShares,
  expiryAfterDays,
  groupExpansionMessage,
  hasShareMoveImpact,
  isShareExpired,
  shareMoveAcrossImpact,
  shareMoveImpact,
  shareScopeLabel,
  shareWidening,
  treeShareMarks,
  wikiShareUrl,
} from './wikiShare'

/** 트리 한 줄 — share 는 자기 공유(없으면 null). */
const node = (id: number, parentId: number | null, share: WikiTreeShare | null = null, title = `p${id}`) => ({
  id,
  parentId,
  title,
  share,
})
/** 상위 공유 제외 표시(WP-987)가 있는 트리 한 줄(WP-1031). */
const excluded = (id: number, parentId: number | null, share: WikiTreeShare | null = null, title = `p${id}`) => ({
  ...node(id, parentId, share, title),
  shareExcluded: true,
})
const own = (audience: WikiShareAudience = 'WORKSPACE', includeChildren = true): WikiTreeShare => ({ audience, includeChildren })

describe('shareWidening — 넓히는 변경만 확인을 받는다', () => {
  const cases: [string, [WikiShareAudience, 'VIEW' | 'EDIT'], [WikiShareAudience, 'VIEW' | 'EDIT'], ReturnType<typeof shareWidening>][] = [
    ['워크스페이스 → 외부', ['WORKSPACE', 'VIEW'], ['PUBLIC', 'VIEW'], 'public'],
    ['지정한 사람 → 외부', ['PEOPLE', 'VIEW'], ['PUBLIC', 'VIEW'], 'public'],
    ['지정한 사람 → 워크스페이스', ['PEOPLE', 'VIEW'], ['WORKSPACE', 'VIEW'], 'audience'],
    ['보기 → 편집', ['WORKSPACE', 'VIEW'], ['WORKSPACE', 'EDIT'], 'permission'],
    ['외부 → 워크스페이스(좁힘)', ['PUBLIC', 'VIEW'], ['WORKSPACE', 'VIEW'], null],
    ['워크스페이스 → 지정한 사람(좁힘)', ['WORKSPACE', 'VIEW'], ['PEOPLE', 'VIEW'], null],
    ['편집 → 보기(좁힘)', ['WORKSPACE', 'EDIT'], ['WORKSPACE', 'VIEW'], null],
    ['외부 → 외부(그대로)', ['PUBLIC', 'VIEW'], ['PUBLIC', 'VIEW'], null],
  ]
  it.each(cases)('%s', (_name, [pa, pp], [na, np], expected) => {
    expect(shareWidening({ audience: pa, permission: pp }, { audience: na, permission: np })).toBe(expected)
  })

  it('지정한 사람 편집 → 외부는 외부가 먼저다', () => {
    expect(shareWidening({ audience: 'PEOPLE', permission: 'EDIT' }, { audience: 'PUBLIC', permission: 'VIEW' })).toBe('public')
  })
})

describe('treeShareMarks — 자기 공유가 상속을 멈춘다(WP-1043)', () => {
  it('자기 공유가 살아 있는 페이지의 하위는 위 하위 포함 공유로 표시하지 않고, 만료된 자기 공유는 멈추지 않는다', () => {
    const marks = treeShareMarks([node(1, null, own()), node(2, 1, own('PEOPLE', false)), node(3, 2), node(4, 1, { ...own('PEOPLE', false), expired: true }), node(5, 4)])
    expect(marks.get(2)).toBe('own')
    expect(marks.has(3)).toBe(false)
    expect(marks.get(5)).toBe('inherited')
  })
})

describe('treeShareMarks — 만료된 자기 공유(WP-1043)', () => {
  it('만료된 자기 공유는 상속을 멈추지 않아 살아 있는 상위 공유가 덮으면 inherited, 덮는 공유가 없으면 own 으로 남는다', () => {
    const expired = { ...own('PEOPLE', false), expired: true }
    const marks = treeShareMarks([node(1, null, own()), node(2, 1, expired), node(3, null, expired), node(4, 2)])
    expect(marks.get(2)).toBe('inherited')
    expect(marks.get(3)).toBe('own')
    expect(marks.get(4)).toBe('inherited')
  })

  it('제외 표시가 있으면 만료된 자기 공유여도 멈춰서 own 이다', () => {
    const marks = treeShareMarks([node(1, null, own()), excluded(2, 1, { ...own('PEOPLE', false), expired: true })])
    expect(marks.get(2)).toBe('own')
  })
})

/** 만료된 하위 포함 공유(WP-1044) — 서버 접근 판정은 만료된 공유로 열지 않으므로 덮는 공유로 세지 않는다. */
const expiredShare = (audience: WikiShareAudience = 'WORKSPACE'): WikiTreeShare => ({ ...own(audience, true), expired: true })

describe('만료된 하위 포함 공유는 덮지 않는다(WP-1044)', () => {
  it('트리: 만료된 하위 포함 공유 아래는 inherited 가 아니고, 살아 있는 공유 아래는 inherited 다', () => {
    const marks = treeShareMarks([node(1, null, expiredShare()), node(2, 1), node(3, 2), node(4, null, own()), node(5, 4)])
    expect(marks.get(1)).toBe('own')
    expect(marks.has(2)).toBe(false)
    expect(marks.has(3)).toBe(false)
    expect(marks.get(5)).toBe('inherited')
  })

  it('트리: 살아 있는 공유 아래의 만료된 하위 포함 공유는 상속을 멈추지 않아 그 아래는 바깥 공유로 inherited 다', () => {
    const marks = treeShareMarks([node(1, null, own()), node(2, 1, expiredShare()), node(3, 2)])
    expect(marks.get(2)).toBe('inherited')
    expect(marks.get(3)).toBe('inherited')
  })

  it('같은 스페이스: 만료된 공유 아래로 옮겨도 entering 이 없고, 살아 있는 공유 아래로는 entering 이다', () => {
    const t = [node(1, null, expiredShare(), '만료'), node(2, 1), node(3, null), node(4, null, own(), '살아 있음')]
    expect(shareMoveImpact(t, 3, 2)).toEqual({ leaving: [], entering: [], blocked: [] })
    expect(hasShareMoveImpact(shareMoveImpact(t, 3, 2))).toBe(false)
    expect(shareMoveImpact(t, 3, 4).entering.map((s) => s.pageId)).toEqual([4])
  })

  it('같은 스페이스: 만료된 공유 아래에서 꺼내도 leaving 이 없고, 살아 있는 공유 아래에서 꺼내면 leaving 이다', () => {
    const t = [node(1, null, expiredShare(), '만료'), node(2, 1), node(3, null), node(4, null, own(), '살아 있음'), node(5, 4)]
    expect(shareMoveImpact(t, 2, 3)).toEqual({ leaving: [], entering: [], blocked: [] })
    expect(shareMoveImpact(t, 5, 3).leaving.map((s) => s.pageId)).toEqual([4])
  })

  it('같은 스페이스: 살아 있는 공유 아래의 만료된 공유 아래로 옮기면 바깥 살아 있는 공유만 entering 이다', () => {
    const t = [node(1, null, own(), '바깥'), node(2, 1, expiredShare(), '만료'), node(3, null)]
    expect(shareMoveImpact(t, 3, 2).entering.map((s) => s.pageId)).toEqual([1])
  })

  it('제외된 페이지를 만료된 공유 아래로 옮기면 blocked 도 없다', () => {
    const t = [node(1, null, own(), '로드맵'), excluded(2, 1), node(4, null, expiredShare(), '만료')]
    expect(shareMoveImpact(t, 2, 4)).toEqual({ leaving: [], entering: [], blocked: [] })
  })

  it('다른 스페이스: 만료된 공유에서 빠지거나 만료된 공유에 들어가는 것으로 세지 않는다', () => {
    const src = [node(1, null, expiredShare(), '만료'), node(2, 1)]
    const target = [node(7, null, expiredShare('PUBLIC'), '만료 공개'), node(8, 7), node(9, null, own('PUBLIC'), '공개'), node(10, 9)]
    expect(shareMoveAcrossImpact(src, 2, target, 8)).toEqual({ leaving: [], entering: [], blocked: [] })
    expect(shareMoveAcrossImpact(src, 2, target, 10).entering).toEqual([{ pageId: 9, title: '공개', audience: 'PUBLIC' }])
    const live = [node(1, null, own(), '로드맵'), node(2, 1)]
    expect(shareMoveAcrossImpact(live, 2, target, 8).leaving.map((s) => s.pageId)).toEqual([1])
  })
})

describe('treeShareMarks — 트리 공유 표시', () => {
  it('자기 공유는 own, 하위 포함 공유 아래는 손자까지 inherited, 그 밖은 표시 없음', () => {
    const marks = treeShareMarks([node(1, null, own()), node(2, 1), node(3, 2), node(4, null)])
    expect(marks.get(1)).toBe('own')
    expect(marks.get(2)).toBe('inherited')
    expect(marks.get(3)).toBe('inherited')
    expect(marks.has(4)).toBe(false)
  })

  it('하위 포함이 아닌 공유는 자식에게 번지지 않는다', () => {
    const marks = treeShareMarks([node(1, null, own('WORKSPACE', false)), node(2, 1)])
    expect(marks.get(1)).toBe('own')
    expect(marks.has(2)).toBe(false)
  })

  it('자기 공유가 있는 자식은 상위 공유에 포함돼도 own 이다', () => {
    const marks = treeShareMarks([node(1, null, own()), node(2, 1, own('PEOPLE', false))])
    expect(marks.get(2)).toBe('own')
  })

  it('상위 공유에서 제외된 페이지와 그 하위는 inherited 가 아니다 — 제외된 페이지 자신의 하위 포함 공유는 그 아래에 번진다(WP-1031)', () => {
    const marks = treeShareMarks([node(1, null, own()), excluded(2, 1), node(3, 2), excluded(4, 1, own()), node(5, 4)])
    expect(marks.has(2)).toBe(false)
    expect(marks.has(3)).toBe(false)
    expect(marks.get(4)).toBe('own')
    expect(marks.get(5)).toBe('inherited')
  })

  it('사이클이 있어도 멈춘다', () => {
    const marks = treeShareMarks([node(1, 2), node(2, 1)])
    expect(marks.size).toBe(0)
  })
})

describe('shareMoveAcrossImpact — 다른 스페이스로 이동(WP-988)', () => {
  const source = [node(1, null, own('WORKSPACE', true), '로드맵'), node(2, 1)]
  const target = [node(7, null, own('PUBLIC', true), '공개'), node(8, 7), node(9, null)]

  it('원본에서 덮던 공유는 빠지고 대상에서 새 부모를 덮는 공유에 들어간다', () => {
    const r = shareMoveAcrossImpact(source, 2, target, 8)
    expect(r.leaving.map((s) => s.pageId)).toEqual([1])
    expect(r.entering).toEqual([{ pageId: 7, title: '공개', audience: 'PUBLIC' }])
  })

  it('상위 공유에서 제외된 페이지는 빠지거나 들어가지 않고, 새 위치 공유는 blocked 로 알린다(WP-1031)', () => {
    const src = [node(1, null, own('WORKSPACE', true), '로드맵'), excluded(2, 1)]
    const r = shareMoveAcrossImpact(src, 2, target, 8)
    expect(r).toEqual({ leaving: [], entering: [], blocked: [{ pageId: 7, title: '공개', audience: 'PUBLIC' }] })
    expect(hasShareMoveImpact(r)).toBe(true)
  })

  it('공유가 없는 자리로 옮기면 새로 들어가는 공유가 없다', () => {
    expect(shareMoveAcrossImpact(source, 2, target, 9).entering).toEqual([])
    expect(shareMoveAcrossImpact(source, 2, target, null).entering).toEqual([])
  })
})

describe('shareMoveImpact — 하위 포함 공유 안팎 이동', () => {
  const tree = [node(1, null, own('WORKSPACE', true), '로드맵'), node(2, 1), node(3, null), node(4, null, own('PUBLIC', true), '공개')]

  it('공유 안에서 밖으로 옮기면 leaving 에 그 공유가 담긴다', () => {
    const r = shareMoveImpact(tree, 2, null)
    expect(r.leaving.map((s) => s.pageId)).toEqual([1])
    expect(r.entering).toEqual([])
  })

  it('밖에서 안으로 옮기면 entering, 외부 공유는 audience 가 PUBLIC 으로 남는다', () => {
    const r = shareMoveImpact(tree, 3, 4)
    expect(r.entering).toEqual([{ pageId: 4, title: '공개', audience: 'PUBLIC' }])
    expect(r.leaving).toEqual([])
  })

  it('같은 공유 안에서 위치만 바꾸면 영향이 없다', () => {
    const t = [...tree, node(5, 1)]
    expect(shareMoveImpact(t, 5, 2)).toEqual({ leaving: [], entering: [], blocked: [] })
  })

  it('공유 루트 자신을 옮겨도 자기 공유는 따라가므로 빈 결과다', () => {
    expect(shareMoveImpact(tree, 1, 3)).toEqual({ leaving: [], entering: [], blocked: [] })
  })

  it('자기 공유가 살아 있는 페이지를 다른 하위 포함 공유 안으로 옮겨도 열리지 않는다 — entering 이 아니라 blocked 다(WP-1043)', () => {
    const r = shareMoveImpact(tree, 1, 4)
    expect(r).toEqual({ leaving: [], entering: [], blocked: [{ pageId: 4, title: '공개', audience: 'PUBLIC', byOwnShare: true }] })
    expect(hasShareMoveImpact(r)).toBe(true)
  })

  it('자기 공유가 만료됐으면 상속을 멈추지 않으므로 새 공유만 entering 이다(WP-1043)', () => {
    const t = [node(1, null, { ...own(), expired: true }), node(4, null, own('PUBLIC', true), '공개')]
    const r = shareMoveImpact(t, 1, 4)
    expect(r.entering.map((s) => s.pageId)).toEqual([4])
    expect(r.blocked).toEqual([])
  })

  it('자기 공유가 있는 하위 페이지를 상위 하위 포함 공유 밖으로 옮겨도 빠지는 공유가 없다 — 옮기기 전에도 안 열렸다(WP-1043)', () => {
    const t = [node(1, null, own('WORKSPACE', true), '로드맵'), node(2, 1, own('PEOPLE', false)), node(3, null)]
    expect(shareMoveImpact(t, 2, 3)).toEqual({ leaving: [], entering: [], blocked: [] })
  })

  it('사이클 트리에서도 끝난다', () => {
    expect(() => shareMoveImpact([node(1, 2), node(2, 1)], 1, 2)).not.toThrow()
  })

  it('상위 공유에서 제외된 페이지를 다른 하위 포함 공유 아래로 옮기면 entering 이 아니라 blocked 다(WP-1031)', () => {
    const t = [node(1, null, own('WORKSPACE', true), '로드맵'), excluded(2, 1), node(4, null, own('PUBLIC', true), '공개')]
    const r = shareMoveImpact(t, 2, 4)
    expect(r).toEqual({ leaving: [], entering: [], blocked: [{ pageId: 4, title: '공개', audience: 'PUBLIC' }] })
    expect(hasShareMoveImpact(r)).toBe(true)
  })

  it('제외 표시가 없으면 같은 이동이 그대로 leaving·entering 이다', () => {
    const t = [node(1, null, own('WORKSPACE', true), '로드맵'), node(2, 1), node(4, null, own('PUBLIC', true), '공개')]
    const r = shareMoveImpact(t, 2, 4)
    expect(r.leaving.map((s) => s.pageId)).toEqual([1])
    expect(r.entering.map((s) => s.pageId)).toEqual([4])
    expect(r.blocked).toEqual([])
  })

  it('제외된 조상 아래로 옮기면 그 위의 공유는 새로 덮지 않는다 — 조상 체인이 제외 표시에서 멈춘다(WP-1031)', () => {
    const t = [node(1, null, own('WORKSPACE', true), '로드맵'), excluded(2, 1), node(3, null)]
    expect(shareMoveImpact(t, 3, 2)).toEqual({ leaving: [], entering: [], blocked: [] })
    expect(hasShareMoveImpact(shareMoveImpact(t, 3, 2))).toBe(false)
  })
})

describe('shareMoveAcrossImpact — 옮기며 해제되는 자기 공유(WP-1043)', () => {
  const src = [node(1, null, own('WORKSPACE', true), '로드맵'), node(2, 1, own('PEOPLE', false))]
  const target = [node(7, null, own('PUBLIC', true), '공개'), node(8, 7)]

  it('해제되면 옮기기 전에는 옛 공유를 덮지 않았으니 leaving 이 없고, 옮긴 뒤에는 새 공유가 덮으니 entering 이다', () => {
    expect(shareMoveAcrossImpact(src, 2, target, 8, [2])).toEqual({
      leaving: [],
      entering: [{ pageId: 7, title: '공개', audience: 'PUBLIC' }],
      blocked: [],
    })
  })

  it('해제돼도 제외 표시가 있으면 새 공유로 열리지 않아 blocked(제외 문구)다', () => {
    const excl = [node(1, null, own('WORKSPACE', true), '로드맵'), { ...node(2, 1, own('PEOPLE', false)), shareExcluded: true }]
    expect(shareMoveAcrossImpact(excl, 2, target, 8, [2])).toEqual({
      leaving: [],
      entering: [],
      blocked: [{ pageId: 7, title: '공개', audience: 'PUBLIC' }],
    })
  })

  it('해제 목록에 없는 페이지의 자기 공유는 그대로 멈춘다', () => {
    expect(shareMoveAcrossImpact(src, 2, target, 8, [99]).blocked).toEqual([{ pageId: 7, title: '공개', audience: 'PUBLIC', byOwnShare: true }])
  })
})

describe('shareMoveAcrossImpact — 자기 공유가 있는 페이지(WP-1043)', () => {
  it('다른 스페이스의 하위 포함 공유 아래로 옮겨도 열리지 않아 blocked 다', () => {
    const src = [node(1, null, own('WORKSPACE', true), '로드맵'), node(2, 1, own('PEOPLE', false))]
    const target = [node(7, null, own('PUBLIC', true), '공개'), node(8, 7)]
    expect(shareMoveAcrossImpact(src, 2, target, 8)).toEqual({
      leaving: [],
      entering: [],
      blocked: [{ pageId: 7, title: '공개', audience: 'PUBLIC', byOwnShare: true }],
    })
  })
})

describe('blockedShareNotice — 제외된 페이지의 새 위치 공유 안내(WP-1031)', () => {
  it('새로 보이게 된다 대신 열리지 않는다고 적는다', () => {
    expect(blockedShareNotice({ pageId: 4, title: '공개', audience: 'PUBLIC' })).toBe(
      '상위 공유에서 제외돼 있어 새 위치의 「공개」 외부 공개 링크로는 열리지 않습니다.',
    )
    expect(blockedShareNotice({ pageId: 5, title: '', audience: 'WORKSPACE' })).toBe(
      '상위 공유에서 제외돼 있어 새 위치의 「제목 없음」 공유 링크로는 열리지 않습니다.',
    )
  })
})

describe('blockedShareNotice — 자기 공유가 있는 페이지(WP-1043)', () => {
  it('제외 대신 따로 켠 공유가 우선이라 열리지 않는다고 적는다', () => {
    expect(blockedShareNotice({ pageId: 4, title: '공개', audience: 'PUBLIC', byOwnShare: true })).toBe(
      '이 페이지에 따로 켠 공유가 있어 새 위치의 「공개」 외부 공개 링크로는 열리지 않습니다(따로 켠 공유가 우선).',
    )
  })
})

describe('countDescendants', () => {
  it('손자까지 센다', () => {
    expect(countDescendants([node(1, null), node(2, 1), node(3, 2), node(4, null)], 1)).toBe(2)
  })
  it('하위가 없으면 0', () => {
    expect(countDescendants([node(1, null), node(2, null)], 1)).toBe(0)
  })
  it('사이클이 있어도 한 번씩만 센다', () => {
    expect(countDescendants([node(1, 2), node(2, 1)], 1)).toBe(1)
  })
})

describe('expiryAfterDays', () => {
  it('지금부터 N일 뒤 같은 시각의 ISO', () => {
    expect(expiryAfterDays(30, new Date('2026-10-21T03:00:00.000Z'))).toBe('2026-11-20T03:00:00.000Z')
  })
})

describe('canManageShare — 공유 창은 스페이스 편집자 이상만', () => {
  it('OWNER·EDITOR 는 열 수 있다', () => {
    expect(canManageShare('OWNER', false)).toBe(true)
    expect(canManageShare('EDITOR', false)).toBe(true)
  })
  it('VIEWER·역할 미확인은 열 수 없다(공유 설정·토큰은 서버도 403)', () => {
    expect(canManageShare('VIEWER', false)).toBe(false)
    expect(canManageShare(undefined, false)).toBe(false)
  })
  it('공유 링크로 들어온 화면은 편집 링크여도 열 수 없다', () => {
    expect(canManageShare('EDITOR', true)).toBe(false)
  })
})

describe('shareScopeLabel·wikiShareUrl', () => {
  it('범위 한 줄', () => {
    expect(shareScopeLabel('WORKSPACE', 'VIEW', 0)).toBe('워크스페이스 전체 · 보기')
    expect(shareScopeLabel('PEOPLE', 'EDIT', 3)).toBe('3명 · 편집')
    expect(shareScopeLabel('PUBLIC', 'VIEW', 0)).toBe('외부 공개 · 보기')
  })
  it('지정한 부서가 있으면 함께 센다(WP-1023)', () => {
    expect(shareScopeLabel('PEOPLE', 'VIEW', 3, 1)).toBe('3명, 부서 1개 · 보기')
    expect(shareScopeLabel('PEOPLE', 'EDIT', 0, 2)).toBe('부서 2개 · 편집')
    expect(shareScopeLabel('PEOPLE', 'VIEW', 0, 0)).toBe('0명 · 보기')
  })
  it('링크 주소', () => {
    expect(wikiShareUrl('wsh_abc', 'https://x.test')).toBe('https://x.test/wiki/share/wsh_abc')
  })
})

describe('isShareExpired·countLivePublicShares — 외부 공유를 끄면 막히는 수', () => {
  const now = new Date('2026-10-21T00:00:00Z')
  it('만료가 없으면 지나지 않은 것, 지난 시각이면 만료', () => {
    expect(isShareExpired(null, now)).toBe(false)
    expect(isShareExpired('2026-10-20T23:59:59Z', now)).toBe(true)
    expect(isShareExpired('2026-10-21T00:00:01Z', now)).toBe(false)
  })
  it('외부 공개 중 만료되지 않은 것만 센다(만료된 것·다른 범위는 제외)', () => {
    const items = [
      { audience: 'PUBLIC' as const, expiresAt: null },
      { audience: 'PUBLIC' as const, expiresAt: '2026-11-01T00:00:00Z' },
      { audience: 'PUBLIC' as const, expiresAt: '2026-10-01T00:00:00Z' },
      { audience: 'WORKSPACE' as const, expiresAt: null },
      { audience: 'PEOPLE' as const, expiresAt: null },
    ]
    expect(countLivePublicShares(items, now)).toBe(2)
    expect(countLivePublicShares([], now)).toBe(0)
  })
})

describe('사람·팀 추가(WP-1023)', () => {

  it('내 그룹 구성원 중 아직 없는 사람만 뒤에 더하고 더한 수·뺀 수를 센다(구성원 중복은 한 번)', () => {
    expect(addGroupMembers([3, 5], [5, 7, 8, 7])).toEqual({ userIds: [3, 5, 7, 8], added: 2, skipped: 1 })
    expect(addGroupMembers([3], [3])).toEqual({ userIds: [3], added: 0, skipped: 1 })
    expect(addGroupMembers([], [])).toEqual({ userIds: [], added: 0, skipped: 0 })
    // 빼는 사람(나·공유를 만든 사람)은 더하지도 이미 있는 수로 세지도 않는다.
    expect(addGroupMembers([3], [1, 3, 9], [1, 3])).toEqual({ userIds: [3, 9], added: 1, skipped: 0 })
  })

  it('펼친 뒤 안내 문구', () => {
    expect(groupExpansionMessage('개발 스터디', 3, 1)).toBe('개발 스터디에서 3명 추가 (이미 있는 1명 제외)')
    expect(groupExpansionMessage('개발 스터디', 2, 0)).toBe('개발 스터디에서 2명 추가')
    expect(groupExpansionMessage('개발 스터디', 0, 2)).toBe('개발 스터디의 2명은 이미 모두 있습니다')
    expect(groupExpansionMessage('개발 스터디', 0, 0)).toBe('개발 스터디에 추가할 사람이 없습니다')
  })
})
