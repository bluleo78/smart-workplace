// @vitest-environment jsdom
// 앱 링크 빌더(WP-1234) — 지금 origin 으로 대상별 절대 링크를 만든다.
import { describe, expect, it } from 'vitest'

import { appUrl, calendarEventPath, driveFolderPath, issuePath, mailMessagePath, wikiPagePath } from './appUrl'

describe('appUrl', () => {
  it('앱 안 경로를 지금 origin 의 절대 URL 로 만든다', () => {
    expect(appUrl('/projects/WP/issues/3')).toBe(`${window.location.origin}/projects/WP/issues/3`)
  })

  it('쿼리·해시를 그대로 둔다', () => {
    expect(appUrl('/mail/2?messageId=9#x')).toBe(`${window.location.origin}/mail/2?messageId=9#x`)
  })

  it('이미 절대 URL 이면 바꾸지 않는다', () => {
    expect(appUrl('https://works.example.com/wiki/open/1')).toBe('https://works.example.com/wiki/open/1')
  })
})

describe('대상별 경로', () => {
  it('이슈·노트·일정·메일', () => {
    expect(issuePath('WP', 12)).toBe('/projects/WP/issues/12')
    expect(wikiPagePath(41)).toBe('/wiki/open/41')
    expect(calendarEventPath(7)).toBe('/calendar?eventId=7')
    expect(mailMessagePath(3, 99)).toBe('/mail/3?messageId=99')
  })

  it('드라이브 폴더 — 공간 루트면 folderId 를 붙이지 않는다', () => {
    expect(driveFolderPath(5, null)).toBe('/drive/spaces/5')
    expect(driveFolderPath(5, 8)).toBe('/drive/spaces/5?folderId=8')
  })
})
