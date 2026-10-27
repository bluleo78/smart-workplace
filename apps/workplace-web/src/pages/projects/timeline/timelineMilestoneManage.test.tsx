// 타임라인 마일스톤 관리 권한(WP-1008) — 페이지 테스트(WP-971).
// 마일스톤 추가·수정·삭제는 버전처럼 프로젝트 OWNER(·테넌트 ADMIN)만 — OWNER 가 아닌 멤버에게는 「마일스톤 추가」를 그리지 않는다.
// 데스크톱 간트(SVAR)는 jsdom 에서 그려지지 않아 모바일(아젠다) 셸로 본다 — 헤더의 같은 판정(canManageMilestones)을 지난다.
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { MOBILE_MEDIA_QUERY } from '@/lib/mobile/breakpoint'
import { projectMetaHandlers, settleMembers } from '@/test/msw/projectMetaHandlers'
import { KEY, OWNER_MEMBERS, PLAIN_MEMBERS } from '@/test/msw/versionHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { MemberResponse } from '@/types/project'

// 모바일 폭으로 판정되게 한다 — mediaQueryStore 가 MediaQueryList 를 처음 쓸 때 캐시하므로 렌더 전에(beforeEach) 바꿔 둔다.
// 진짜 matchMedia 는 모듈에서 한 번만 잡는다 — beforeEach 마다 잡으면 앞 테스트의 스파이를 감싸 무한 재귀가 된다.
const realMatchMedia = window.matchMedia.bind(window)
beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const mql = realMatchMedia(query)
    return query === MOBILE_MEDIA_QUERY ? ({ ...mql, matches: true, media: query } as MediaQueryList) : mql
  })
})

describe('타임라인 — 마일스톤 관리 권한', () => {
  async function openTimeline(members: MemberResponse[]) {
    const view = renderPage(`/projects/${KEY}/timeline`, { handlers: projectMetaHandlers(members) })
    // 아젠다가 그려진 뒤(빈 상태 포함)를 기다린다 — 화면이 오류 경계로 떨어지면 아래 「없음」 이 거짓으로 통과한다.
    expect(await screen.findByTestId('timeline-page', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByText(/일시적인 오류가 발생했습니다/)).not.toBeInTheDocument()
    await settleMembers(view)
    return view
  }

  test('OWNER 는 「마일스톤 추가」가 보인다(양성 대조)', async () => {
    await openTimeline(OWNER_MEMBERS)
    expect(await screen.findByTestId('milestone-add-button')).toBeInTheDocument()
  })

  test('OWNER 가 아닌 멤버는 「마일스톤 추가」가 없다', async () => {
    await openTimeline(PLAIN_MEMBERS)
    expect(screen.queryByTestId('milestone-add-button')).not.toBeInTheDocument()
  })
})
