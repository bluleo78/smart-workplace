// WP-300 회귀 — 노트 본문의 마크다운 링크 [text](url) 가 에디터를 거치면 글자만 남던 문제.
// 공용 스키마에 link 마크가 없어 markdown-it 이 만든 <a> 를 ProseMirror 가 버렸다.
import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { wikiSchemaExtensions } from './extensions'
import { docToMarkdown, markdownToDoc } from './markdown'

/** 마크다운 → 문서 → 마크다운 한 바퀴. */
const roundtrip = (md: string) => docToMarkdown(markdownToDoc(md))

/** 첫 문단 첫 텍스트 노드의 link 마크 attrs(없으면 undefined). */
function firstLinkAttrs(md: string): Record<string, unknown> | undefined {
  let attrs: Record<string, unknown> | undefined
  markdownToDoc(md).descendants((n) => {
    const mark = n.marks.find((m) => m.type.name === 'link')
    if (mark && !attrs) attrs = mark.attrs
  })
  return attrs
}

/** 문서 JSON 을 웹과 같은 스키마로 렌더한 HTML. */
function renderHTML(content: unknown): string {
  const ed = new Editor({ extensions: wikiSchemaExtensions(), content: content as string })
  const html = ed.getHTML()
  ed.destroy()
  return html
}

describe('마크다운 링크 왕복 (WP-300)', () => {
  it.each([
    ['기본 링크', '[문서](https://example.com)'],
    ['문장 안의 링크', '자세한 내용은 [설계 문서](https://example.com/a?b=1&c=2) 참고.'],
    ['제목 붙은 링크', '[문서](https://example.com "설명")'],
    ['괄호가 든 주소', '[위키](https://en.wikipedia.org/wiki/Foo_\\(bar\\))'],
    ['꺾쇠 자동 링크', '<https://example.com>'],
    ['메일 링크', '[메일](mailto:a@example.com)'],
    ['상대 경로', '[페이지](/wiki/spaces/1/pages/2)'],
  ])('%s 가 링크로 유지된다', (_, md) => {
    const once = roundtrip(md)
    expect(once).toBe(md)
    expect(roundtrip(once)).toBe(once)
  })

  it('주소와 글자가 같은 링크는 <url> 로 정규화되고 그 뒤로는 안정적이다', () => {
    const once = roundtrip('[https://example.com](https://example.com)')
    expect(once).toBe('<https://example.com>')
    expect(roundtrip(once)).toBe(once)
  })

  it('굵게 안의 링크는 링크가 바깥으로 정규화되고 그 뒤로는 안정적이다', () => {
    // link 마크 우선순위(1000)가 bold 보다 높아 마크 순서가 [**t**](u) 로 정해진다 — 의미는 같다.
    const once = roundtrip('**[굵은 링크](https://example.com)**')
    expect(once).toBe('[**굵은 링크**](https://example.com)')
    expect(roundtrip(once)).toBe(once)
  })

  it('표 셀 안의 링크가 유지된다', () => {
    const md = '| 이름 | 링크 |\n| --- | --- |\n| 설계 | [문서](https://example.com) |\n'
    expect(roundtrip(md)).toBe(md)
  })

  it('문서 속성에는 href·title 만 담는다 — 마크다운이 못 싣는 target/rel 로 라이브 문서와 재파싱 문서가 갈리지 않게', () => {
    expect(firstLinkAttrs('[문서](https://example.com "설명")')).toEqual({ href: 'https://example.com', title: '설명' })
    expect(firstLinkAttrs('<a href="https://example.com" target="_self" rel="opener" class="x">문서</a>')).toEqual({
      href: 'https://example.com',
      title: null,
    })
  })

  it('렌더한 링크는 새 탭 + noopener 로 열린다', () => {
    const html = renderHTML('[문서](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })
})

describe('HTML 로 들어온 링크 주소 정규화 (WP-300 리뷰)', () => {
  // HTML 붙여넣기 등으로 들어온 href 는 markdown-it 을 거치지 않아 정규화되지 않았다 — 공백이 든 주소는 저장 후
  // 링크 문법이 깨져 평문이 되고, | < 비ASCII 는 두 번째 저장에서 인코딩돼 저장할 때마다 본문이 바뀌었다.
  it.each([
    ['공백', 'https://example.com/a b', 'https://example.com/a%20b'],
    ['파이프', 'https://example.com/a|b', 'https://example.com/a%7Cb'],
    ['꺾쇠', 'https://example.com/a<b', 'https://example.com/a%3Cb'],
    ['비ASCII', 'https://예시.com/한글', 'https://xn--vv4b11d.com/%ED%95%9C%EA%B8%80'],
  ])('%s 가 든 주소가 같은 링크로 왕복한다', (_, raw, normalized) => {
    const once = roundtrip(`<a href="${raw}">문서</a>`)
    expect(once).toBe(`[문서](${normalized})`)
    expect(roundtrip(once)).toBe(once)
  })

  it('이미 인코딩된 주소는 다시 인코딩하지 않는다', () => {
    expect(firstLinkAttrs('<a href="https://example.com/a%20b">문서</a>')?.href).toBe('https://example.com/a%20b')
  })
})

describe('코드를 감싼 링크 (WP-300 리뷰)', () => {
  it('[`code`](url) 가 링크로 왕복한다', () => {
    const md = '[`code`](https://example.com)'
    expect(roundtrip(md)).toBe(md)
  })

  it('링크 없는 코드 서식의 기존 직렬화는 그대로다 — 굵게·기울임·취소선과는 여전히 함께 쓰지 않는다', () => {
    expect(roundtrip('**`c`** and *`d`* ~~`e`~~ `f`')).toBe('`c` and `d` `e` `f`')
  })
})

describe('꺾쇠 자동 링크의 주소 보존 (WP-300 리뷰)', () => {
  it('<url> 안의 특수문자를 이스케이프하지 않는다 — 꺾쇠 안에선 백슬래시가 주소 글자가 된다', () => {
    const md = '<https://example.com/a_b*c>'
    expect(roundtrip(md)).toBe(md)
    expect(roundtrip(roundtrip(md))).toBe(md)
  })
})

describe('표 셀 안 링크의 | (WP-300 리뷰)', () => {
  it('링크 title 의 | 가 이스케이프되어 셀이 쪼개지지 않는다', () => {
    const md = '| a |\n| --- |\n| [t](https://x.com "a\\|b") |\n'
    expect(roundtrip(md)).toBe(md)
    expect(roundtrip(roundtrip(md))).toBe(md)
  })

  it('표 셀 안 꺾쇠 자동 링크도 그대로 왕복한다', () => {
    const md = '| a |\n| --- |\n| <https://example.com/a_b*c> |\n'
    expect(roundtrip(md)).toBe(md)
  })

  it('문서에 | 가 든 href 가 있어도(인코딩 안 된 값) 셀이 쪼개지지 않는다', () => {
    const doc = markdownToDoc('| a |\n| --- |\n| [t](https://x.com) |')
    const json = JSON.parse(JSON.stringify(doc.toJSON()).replace('https://x.com', 'https://x.com/a|b'))
    const out = docToMarkdown(doc.type.schema.nodeFromJSON(json))
    expect(out).toBe('| a |\n| --- |\n| [t](https://x.com/a\\|b) |\n')
  })
})

describe('위험한 링크 차단 (WP-300)', () => {
  it('마크다운 [x](javascript:…) 는 링크가 되지 않고 글자로 남는다', () => {
    expect(firstLinkAttrs('[x](javascript:alert(1))')).toBeUndefined()
  })

  it('HTML <a href="javascript:…"> 는 링크가 버려지고 글자만 남는다', () => {
    const md = '<a href="javascript:alert(1)">y</a>'
    expect(firstLinkAttrs(md)).toBeUndefined()
    expect(roundtrip(md)).toBe('y')
  })

  it('문서에 javascript: href 가 들어와도 렌더 시 href 가 비워진다', () => {
    const html = renderHTML({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
        },
      ],
    })
    expect(html).not.toContain('javascript:')
  })

  it('맨 URL 을 쳐도 자동 링크로 바뀌지 않는다 — 저장 마크다운이 그대로다', () => {
    expect(roundtrip('https://example.com')).toBe('https://example.com')
  })
})
