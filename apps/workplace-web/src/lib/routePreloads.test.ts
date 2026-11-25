// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type Preload, type RoutePreloadKey, selectRoutePreloads, startRoutePreloads } from './routePreloads'

// 일부 키만 채운 로더 맵을 전체 Record 로 본다 — 고르지 않은 키는 호출되지 않아야 하므로 비워 둔다.
const partial = (loaders: Partial<Record<RoutePreloadKey, Preload>>) => loaders as Record<RoutePreloadKey, Preload>

describe('selectRoutePreloads', () => {
  it('첫 일치 항목의 키를 돌려준다', () => {
    expect(selectRoutePreloads('/projects/WP')).toEqual(['projectTabs', 'projectIssues'])
    expect(selectRoutePreloads('/projects/WP/')).toEqual(['projectTabs', 'projectIssues'])
    expect(selectRoutePreloads('/projects/WP/timeline')).toEqual(['projectTabs'])
    expect(selectRoutePreloads('/projects')).toEqual(['projectList'])
    expect(selectRoutePreloads('/mail/inbox/3')).toEqual(['mailLayout', 'mailInbox'])
  })
  it('프로젝트 탭 라우트만 탭 청크를 받는다', () => {
    expect(selectRoutePreloads('/projects/WP/notes')).toEqual(['projectTabs'])
    expect(selectRoutePreloads('/projects/WP/notes/5')).toEqual(['projectTabs'])
    expect(selectRoutePreloads('/projects/WP/versions')).toEqual(['projectTabs'])
    expect(selectRoutePreloads('/projects/WP/workflow')).toEqual(['projectTabs'])
    expect(selectRoutePreloads('/projects/WP/versions/3')).toEqual([])
    expect(selectRoutePreloads('/projects/WP/settings')).toEqual([])
  })
  it('이슈 상세 주소는 상세 청크만 받는다(WP-2074)', () => {
    expect(selectRoutePreloads('/projects/WP/issues/12')).toEqual(['issueDetail'])
    expect(selectRoutePreloads('/projects/WP/issues/12/')).toEqual(['issueDetail'])
    expect(selectRoutePreloads('/projects/WP/issues/abc')).toEqual([])
    expect(selectRoutePreloads('/projects/WP/issues/0')).toEqual([])
    expect(selectRoutePreloads('/projects/WP/issues/12/edit')).toEqual([])
    expect(selectRoutePreloads('/projects/WP/issues')).toEqual([])
  })
  it('셸 밖 화면은 아무것도 미리 받지 않는다', () => {
    expect(selectRoutePreloads('/mail/compose')).toEqual([])
    expect(selectRoutePreloads('/wiki/share/abc')).toEqual([])
    expect(selectRoutePreloads('/wiki/open/1')).toEqual([])
  })
  it('셸 안 위키·메일 화면은 받는다', () => {
    expect(selectRoutePreloads('/wiki')).toEqual(['wikiLayout', 'wikiIndex'])
    expect(selectRoutePreloads('/wiki/spaces/1/pages/2')).toEqual(['wikiLayout'])
    expect(selectRoutePreloads('/wiki/recent')).toEqual(['wikiLayout'])
    expect(selectRoutePreloads('/mail/7')).toEqual(['mailLayout', 'mailInbox'])
  })
  it('채팅·드라이브는 루트만 목록 청크, 깊은 주소는 레이아웃만 받는다', () => {
    expect(selectRoutePreloads('/chat')).toEqual(['chatLayout', 'chatList'])
    expect(selectRoutePreloads('/chat/')).toEqual(['chatLayout', 'chatList'])
    expect(selectRoutePreloads('/chat/channels/5')).toEqual(['chatLayout'])
    expect(selectRoutePreloads('/drive')).toEqual(['driveLayout', 'driveIndex'])
    expect(selectRoutePreloads('/drive/spaces/3')).toEqual(['driveLayout'])
  })
  it('모듈 이름 경계에서만 일치한다', () => {
    expect(selectRoutePreloads('/chatroom')).toEqual([])
    expect(selectRoutePreloads('/drive-x')).toEqual([])
  })
  it('일치가 없으면 빈 배열', () => {
    expect(selectRoutePreloads('/nope')).toEqual([])
    expect(selectRoutePreloads('')).toEqual([])
  })
})

describe('startRoutePreloads', () => {
  const onUnhandled = vi.fn()
  afterEach(() => {
    window.removeEventListener('unhandledrejection', onUnhandled)
    onUnhandled.mockClear()
  })

  it('고른 로더만 부르고 실패는 삼킨다', async () => {
    window.addEventListener('unhandledrejection', onUnhandled)
    const mailLayout = vi.fn().mockResolvedValue(1)
    // 거부 약속의 catch 호출 여부를 직접 본다 — 환경이 unhandled 거부를 이벤트로 알려주지 않아도 .catch 제거를 잡는다
    const rejected = Promise.reject(new Error('x'))
    const catchSpy = vi.spyOn(rejected, 'catch')
    const mailInbox = vi.fn().mockReturnValue(rejected)
    const home = vi.fn()
    startRoutePreloads('/mail', partial({ mailLayout, mailInbox, home }))
    // 거부는 마이크로태스크 뒤에 unhandledrejection 으로 번지므로 매크로태스크까지 기다린다
    await new Promise((r) => setTimeout(r, 0))
    expect(mailLayout).toHaveBeenCalledTimes(1)
    expect(mailInbox).toHaveBeenCalledTimes(1)
    expect(home).not.toHaveBeenCalled()
    expect(catchSpy).toHaveBeenCalledTimes(1)
    expect(onUnhandled).not.toHaveBeenCalled()
  })
})

describe('startInitialRoutePreloads', () => {
  it('같은 문서에서 여러 번 불러도 처음 한 번만 미리 받는다(App 다시 마운트)', async () => {
    // 모듈 안의 「이미 시작함」 표시를 새로 시작하려고 모듈을 다시 불러온다
    vi.resetModules()
    const { startInitialRoutePreloads } = await import('./routePreloads')
    const mailLayout = vi.fn().mockResolvedValue(1)
    const mailInbox = vi.fn().mockResolvedValue(1)
    const loaders = partial({ mailLayout, mailInbox })
    startInitialRoutePreloads('/mail', loaders)
    startInitialRoutePreloads('/mail', loaders)
    startInitialRoutePreloads('/mail/3', loaders)
    expect(mailLayout).toHaveBeenCalledTimes(1)
    expect(mailInbox).toHaveBeenCalledTimes(1)
  })
})
