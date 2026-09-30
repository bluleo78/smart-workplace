// 모바일 경로 판정 순수 함수 테스트 — 탭바 표시 여부·뒤로가기 대상이 경로 표(spec 3.4)와 일치하는지 고정.
import { describe, expect, it } from 'vitest'

import { isTabRoot, moduleRootFor, norm, resolveBackTarget } from './routes'

describe('isTabRoot', () => {
  it.each([
    '/', '/chat', '/mail', '/mail/3', '/tasks', '/calendar', '/drive', '/wiki',
    '/contacts', '/notifications', '/apps', '/apps/tabs',
  ])('%s 는 탭 루트', (p) => expect(isTabRoot(p)).toBe(true))

  it.each([
    '/chat/channels/1', '/chat/dms/2', '/chat/new', '/chat/threads/inbox',
    '/projects', '/projects/MOB', '/projects/MOB/issues/1', '/me/tasks/assigned', '/me/ai-tasks',
    '/drive/spaces/5', '/drive/attachments', '/wiki/spaces/1', '/wiki/spaces/1/pages/2',
    '/settings/profile', '/settings', '/profile',
  ])('%s 는 상세', (p) => expect(isTabRoot(p)).toBe(false))

  it('끝 슬래시를 무시한다', () => expect(isTabRoot('/chat/')).toBe(true))
})

describe('moduleRootFor', () => {
  it.each([
    ['/chat/channels/1', '/chat'],
    ['/projects/MOB/issues/1', '/tasks'],
    ['/me/tasks/assigned', '/tasks'],
    ['/drive/spaces/5', '/drive'],
    ['/wiki/spaces/1/pages/2', '/wiki'],
    ['/settings/notifications', '/settings'],
    // /settings 목록 자체는 탭 루트가 아니므로 진입점(앱 목록)으로 — 자기 자신으로의 루프 방지.
    ['/settings', '/apps'],
    ['/settings/', '/apps'],
    ['/mail/3', '/mail'],
    ['/profile', '/apps'],
    ['/unknown', '/'],
  ])('%s → %s', (p, root) => expect(moduleRootFor(p)).toBe(root))
})

describe('resolveBackTarget', () => {
  it('앱 내 히스토리가 있으면 -1', () => expect(resolveBackTarget('/chat/channels/1', 3)).toBe(-1))
  it('딥링크 첫 진입(idx 0)이면 모듈 루트', () => expect(resolveBackTarget('/chat/channels/1', 0)).toBe('/chat'))
  it('설정 목록 딥링크는 앱 목록으로', () => expect(resolveBackTarget('/settings', 0)).toBe('/apps'))
  it('idx 가 없으면 모듈 루트', () => expect(resolveBackTarget('/projects/MOB/issues/1', undefined)).toBe('/tasks'))
})

describe('norm', () => {
  it('끝 슬래시를 제거하되 루트는 유지', () => {
    expect(norm('/chat/')).toBe('/chat')
    expect(norm('/chat//')).toBe('/chat')
    expect(norm('/')).toBe('/')
  })
})
