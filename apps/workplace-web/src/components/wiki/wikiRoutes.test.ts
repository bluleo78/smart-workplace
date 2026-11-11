import { describe, expect, it } from 'vitest'

import { defaultWikiRoutes, projectWikiRoutes } from './WikiRoutesContext'

// 노트 화면이 만드는 주소 — 기본(/wiki)과 프로젝트 「노트」 탭(WP-1481) 두 가지.
describe('defaultWikiRoutes', () => {
  it('기존 /wiki 주소를 그대로 만든다', () => {
    expect(defaultWikiRoutes.spacePath(7)).toBe('/wiki/spaces/7')
    expect(defaultWikiRoutes.pagePath(7, 12)).toBe('/wiki/spaces/7/pages/12')
    expect(defaultWikiRoutes.homePath()).toBe('/wiki')
  })
})

describe('projectWikiRoutes', () => {
  const routes = projectWikiRoutes(7, '/projects/WP/notes')
  it('프로젝트 공간은 탭 주소', () => {
    expect(routes.spacePath(7)).toBe('/projects/WP/notes')
    expect(routes.pagePath(7, 12)).toBe('/projects/WP/notes/12')
    expect(routes.homePath()).toBe('/projects/WP/notes')
  })
  it('다른 공간은 기본 주소', () => {
    expect(routes.pagePath(8, 12)).toBe('/wiki/spaces/8/pages/12')
    expect(routes.spacePath(8)).toBe('/wiki/spaces/8')
  })
})
