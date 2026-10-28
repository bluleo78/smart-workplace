// 앱 링크 읽기(WP-896) — 같은 호스트의 이슈·노트·파일 경로만 카드 대상으로, 서버와 같은 3개 상한·마크다운 규칙.
import { describe, expect, it } from 'vitest'

import { appLinksOf, cardUrls, parseAppLink } from './appLinks'

const HOST = 'works.example.com'

describe('parseAppLink', () => {
  it('이슈·노트·파일 경로를 종류·id·이동 경로로 읽는다', () => {
    expect(parseAppLink('https://works.example.com/projects/wp/issues/1090', HOST)).toEqual({
      kind: 'ISSUE', to: '/projects/WP/issues/1090', key: 'WP', number: 1090,
    })
    expect(parseAppLink('https://works.example.com/wiki/spaces/3/pages/41', HOST)).toMatchObject({ kind: 'PAGE', pageId: 41, to: '/wiki/spaces/3/pages/41' })
    expect(parseAppLink('https://works.example.com/wiki/open/41', HOST)).toMatchObject({ kind: 'PAGE', pageId: 41, to: '/wiki/open/41' })
    expect(parseAppLink('https://works.example.com/drive/spaces/5?file=77&x=1', HOST)).toMatchObject({ kind: 'FILE', fileId: 77, to: '/drive/spaces/5?file=77' })
  })

  it('호스트는 대소문자·포트와 무관하게 같으면 앱 링크다', () => {
    expect(parseAppLink('http://WORKS.example.com:8443/wiki/open/1', HOST)).toMatchObject({ kind: 'PAGE', pageId: 1 })
  })

  it.each([
    ['다른 호스트', 'https://evil.example.com/projects/WP/issues/1'],
    ['하위 도메인', 'https://a.works.example.com/projects/WP/issues/1'],
    ['앱 화면이 아닌 경로', 'https://works.example.com/settings/profile'],
    ['이슈 번호가 숫자가 아님', 'https://works.example.com/projects/WP/issues/abc'],
    ['이슈 하위 경로', 'https://works.example.com/projects/WP/issues/1/edit'],
    ['파일 id 없는 드라이브', 'https://works.example.com/drive/spaces/5'],
    ['노트 스페이스만', 'https://works.example.com/wiki/spaces/3'],
    ['URL 이 아님', 'works.example.com/projects/WP/issues/1'],
  ])('%s 은(는) 앱 링크가 아니다', (_name, href) => {
    expect(parseAppLink(href, HOST)).toBeNull()
  })
})

describe('cardUrls · appLinksOf', () => {
  it('서버처럼 본문 앞 3개 링크 안에서만 고르고, 같은 대상은 카드 하나', () => {
    const body = [
      'https://works.example.com/projects/WP/issues/1',
      'https://works.example.com/projects/WP/issues/1.',
      'https://other.example.com/a',
      'https://works.example.com/wiki/open/9',
      'https://works.example.com/wiki/open/8',
    ].join(' ')
    // 끝 마침표는 빼고 읽어 처음 둘이 같은 URL — 남은 앞 3개는 이슈·외부·노트9.
    expect(cardUrls(body)).toEqual([
      'https://works.example.com/projects/WP/issues/1',
      'https://other.example.com/a',
      'https://works.example.com/wiki/open/9',
    ])
    expect(appLinksOf(body, HOST).map((l) => l.to)).toEqual(['/projects/WP/issues/1', '/wiki/open/9'])
  })

  it('마크다운 링크는 주소만 본다', () => {
    expect(appLinksOf('[릴리스 이슈](https://works.example.com/projects/WP/issues/7) 확인', HOST)).toMatchObject([{ kind: 'ISSUE', number: 7 }])
  })
})
