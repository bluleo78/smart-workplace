// 앱 링크 읽기(WP-896) — 같은 호스트의 이슈·노트·파일 경로만 카드 대상으로, 서버와 같은 3개 상한·마크다운 규칙.
import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appLinksOf, cardUrls, currentAppHosts, parseAppLink, setPublicAppHost, visibleAppLinks, withoutMarkdownCode } from './appLinks'

// 서버 LinkPreviewDispatcherTest 와 함께 읽는 앱 카드 주소 사례 표(WP-1165) — 두 쪽 경로 문법·자릿수 상한이 어긋나면 한쪽이 실패한다.
const SHARED_TABLE = JSON.parse(
  readFileSync(new URL('../../../workplace-api/src/test/resources/app-links/app-card-urls.json', import.meta.url), 'utf8'),
) as { host: string; cases: { url: string; card: boolean }[] }

const HOST = ['works.example.com']

describe('parseAppLink', () => {
  it('이슈·노트·파일 경로를 종류·id·이동 경로로 읽는다', () => {
    expect(parseAppLink('https://works.example.com/projects/wp/issues/1090', HOST)).toEqual({
      kind: 'ISSUE', to: '/projects/WP/issues/1090', key: 'WP', number: 1090,
    })
    expect(parseAppLink('https://works.example.com/wiki/spaces/3/pages/41', HOST)).toMatchObject({ kind: 'PAGE', pageId: 41, to: '/wiki/spaces/3/pages/41' })
    expect(parseAppLink('https://works.example.com/wiki/open/41', HOST)).toMatchObject({ kind: 'PAGE', pageId: 41, to: '/wiki/open/41' })
    expect(parseAppLink('https://works.example.com/drive/spaces/5?file=77&x=1', HOST)).toMatchObject({ kind: 'FILE', fileId: 77, to: '/drive/spaces/5?file=77' })
  })

  it('🔗 가 복사하는 드라이브 미리보기 주소(?preview)도 파일 카드다 — 이동 경로에 폴더를 남겨 그 파일이 열리게(WP-1235)', () => {
    expect(parseAppLink('https://works.example.com/drive/spaces/5?folderId=3&preview=77', HOST)).toEqual({
      kind: 'FILE', fileId: 77, to: '/drive/spaces/5?folderId=3&preview=77',
    })
    expect(parseAppLink('https://works.example.com/drive/spaces/5?preview=77', HOST)).toMatchObject({ to: '/drive/spaces/5?preview=77' })
    // 첨부 보기(/drive/attachments)의 file:<id> 모양은 드라이브 파일 id 가 아니다.
    expect(parseAppLink('https://works.example.com/drive/spaces/5?preview=file:9', HOST)).toBeNull()
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

describe('서버와 같은 사례 표', () => {
  it.each(SHARED_TABLE.cases)('$url → 앱 카드 $card', ({ url, card }) => {
    expect(parseAppLink(url, [SHARED_TABLE.host]) !== null).toBe(card)
  })

  it('읽은 id 는 주소의 숫자와 같다 — 상한(노트·파일 15자리)까지 Number 로 바꿔도 값이 바뀌지 않는다', () => {
    expect(parseAppLink('http://localhost/wiki/open/999999999999999', ['localhost'])).toMatchObject({ pageId: 999999999999999 })
    expect(parseAppLink('http://localhost/drive/spaces/1?file=999999999999999', ['localhost'])).toMatchObject({ fileId: 999999999999999 })
    expect(parseAppLink('http://localhost/projects/WP/issues/999999999', ['localhost'])).toMatchObject({ number: 999999999 })
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

  it('경로가 달라도 같은 노트면 카드 하나 — 앞에 나온 링크를 쓴다', () => {
    const body = 'https://works.example.com/wiki/open/5 https://works.example.com/wiki/spaces/1/pages/5'
    expect(appLinksOf(body, HOST)).toEqual([{ kind: 'PAGE', pageId: 5, to: '/wiki/open/5' }])
  })

  it('마크다운 링크는 주소만 본다', () => {
    expect(appLinksOf('[릴리스 이슈](https://works.example.com/projects/WP/issues/7) 확인', HOST)).toMatchObject([{ kind: 'ISSUE', number: 7 }])
  })
})

describe('공개 웹 주소 호스트(WP-1165)', () => {
  // 내부 주소(사설 IP)로 접속한 화면 — 서버의 공개 웹 주소 호스트와 다르다.
  beforeEach(() => vi.stubGlobal('window', { location: { hostname: '10.0.0.5' } }))
  afterEach(() => {
    setPublicAppHost(null)
    vi.unstubAllGlobals()
  })

  it('내부 호스트로 접속해도 서버가 알려 준 공개 호스트의 링크는 앱 카드다', () => {
    const body = 'https://works.example.com/projects/WP/issues/1'
    // 공개 호스트를 받기 전에는 남의 주소로 본다(그런데 서버는 OG 미리보기를 빼 아무것도 나오지 않던 경우).
    expect(visibleAppLinks({ body })).toEqual([])
    setPublicAppHost('Works.Example.com')
    expect(currentAppHosts()).toEqual(['10.0.0.5', 'works.example.com'])
    expect(visibleAppLinks({ body })).toMatchObject([{ kind: 'ISSUE', key: 'WP', number: 1 }])
    // 지금 호스트의 링크도 그대로 카드다.
    expect(visibleAppLinks({ body: 'http://10.0.0.5:6173/wiki/open/3' })).toMatchObject([{ kind: 'PAGE', pageId: 3 }])
  })

  it('서버 설정이 비었으면(null) 지금 호스트만 본다', () => {
    setPublicAppHost(null)
    expect(currentAppHosts()).toEqual(['10.0.0.5'])
  })

  it('공개 호스트가 지금 호스트와 같으면 하나만 둔다', () => {
    setPublicAppHost('10.0.0.5')
    expect(currentAppHosts()).toEqual(['10.0.0.5'])
  })
})

describe('withoutMarkdownCode(WP-1235)', () => {
  const u = (n: number) => `https://app.example/projects/WP/issues/${n}`

  it('닫힌 ``` · ~~~ 펜스와 인라인 코드 안 주소는 지우고, 밖의 주소는 남긴다', () => {
    const body = ['보세요 ' + u(1), '```ts', u(2), '```', '~~~', u(3), '~~~', `인라인 \`${u(4)}\` 과 \`\`${u(5)}\`\``, u(6)].join('\n')
    expect(cardUrls(withoutMarkdownCode(body))).toEqual([u(1), u(6)])
  })

  it('닫히지 않은 펜스는 끝까지 코드다', () => {
    expect(cardUrls(withoutMarkdownCode(`${u(1)}\n\`\`\`\n${u(2)}\n${u(3)}`))).toEqual([u(1)])
  })

  it('여는 펜스보다 짧은 줄이나 다른 글자는 닫지 않는다', () => {
    expect(cardUrls(withoutMarkdownCode(`\`\`\`\`\n\`\`\`\n${u(1)}\n~~~~\n\`\`\`\`\n${u(2)}`))).toEqual([u(2)])
  })

  it('코드를 거른 뒤 앞에서 3개까지 — 코드 안 주소가 자리를 차지하지 않는다', () => {
    const body = [`\`${u(1)}\``, u(2), u(3), u(4), u(5)].join(' ')
    expect(cardUrls(withoutMarkdownCode(body))).toEqual([u(2), u(3), u(4)])
  })
})
