// WP-1240 — 모양 속성 정리 순수 함수. 파싱·렌더·직렬화가 모두 이 함수를 지나므로 위험 글자가 남지 않고, 결과가 멱등이어야 한다.
import { describe, expect, it } from 'vitest'

import {
  escapeHtmlAttr,
  isSafeDeclaration,
  sanitizeBoxTag,
  sanitizeClassName,
  sanitizeInlineStyle,
  sanitizeStyleSheet,
} from './htmlSanitize'

describe('sanitizeClassName', () => {
  it('keeps only [A-Za-z0-9_-] tokens joined by one space', () => {
    expect(sanitizeClassName('  card  big\nbadge_1 x-y ')).toBe('card big badge_1 x-y')
    expect(sanitizeClassName('ok "><script> a.b c:d')).toBe('ok')
  })

  it('returns null when nothing is left or the value is not a string', () => {
    expect(sanitizeClassName('<x> "y"')).toBeNull()
    expect(sanitizeClassName('')).toBeNull()
    expect(sanitizeClassName(null)).toBeNull()
  })
})

describe('sanitizeBoxTag', () => {
  it('allows the listed container tags and falls back to div', () => {
    expect(sanitizeBoxTag('SECTION')).toBe('section')
    expect(sanitizeBoxTag('figcaption')).toBe('figcaption')
    expect(sanitizeBoxTag('script')).toBe('div')
    expect(sanitizeBoxTag(undefined)).toBe('div')
  })
})

describe('isSafeDeclaration', () => {
  it('rejects script-ish values even when hidden by comments, escapes or case', () => {
    expect(isSafeDeclaration('width: expression(alert(1))')).toBe(false)
    expect(isSafeDeclaration('width: EXPR/**/ESSION(alert(1))')).toBe(false)
    expect(isSafeDeclaration('background: url(\\6a avascript:alert(1))')).toBe(false)
    expect(isSafeDeclaration('behavior: url(x.htc)')).toBe(false)
    expect(isSafeDeclaration('-moz-binding: url(https://a/x.xml#x)')).toBe(false)
  })

  it('keeps legit properties whose name merely contains behavior', () => {
    expect(isSafeDeclaration('overscroll-behavior: contain')).toBe(true)
    expect(isSafeDeclaration('scroll-behavior: smooth')).toBe(true)
  })

  it('allows url() only for https: and data:image/', () => {
    expect(isSafeDeclaration('background: url("https://cdn.example.com/a.png")')).toBe(true)
    expect(isSafeDeclaration("background: url('data:image/png;base64,AAA=')")).toBe(true)
    expect(isSafeDeclaration('background: url(http://example.com/a.png)')).toBe(false)
    expect(isSafeDeclaration('background: url(/api/v1/x)')).toBe(false)
    expect(isSafeDeclaration('background: url(data:text/html,<b>)')).toBe(false)
    expect(isSafeDeclaration('background: image-set("https://a/x.png" 1x)')).toBe(false)
  })

  it('rejects https url() too when remote urls are not allowed (page stylesheet)', () => {
    expect(isSafeDeclaration('background: url("https://cdn.example.com/a.png")', false)).toBe(false)
    expect(isSafeDeclaration("background: url('data:image/png;base64,AAA=')", false)).toBe(true)
  })

  it('rejects garbage without a property name', () => {
    expect(isSafeDeclaration('color')).toBe(false)
    expect(isSafeDeclaration('"><img: x')).toBe(false)
  })
})

describe('sanitizeInlineStyle', () => {
  it('drops only the dangerous declarations and keeps the rest verbatim', () => {
    expect(sanitizeInlineStyle('color:#16a34a; background:url(javascript:alert(1));margin:8px')).toBe('color:#16a34a; margin:8px')
  })

  it('does not split on ; inside url() or strings', () => {
    expect(sanitizeInlineStyle("background:url(data:image/png;base64,AA==); content:';'")).toBe(
      "background:url(data:image/png;base64,AA==); content:';'",
    )
  })

  it('collapses newlines so the opening tag stays on one line', () => {
    expect(sanitizeInlineStyle('color: red;\n\n  padding: 4px')).toBe('color: red; padding: 4px')
  })

  it('is idempotent and returns null when nothing is left', () => {
    const once = sanitizeInlineStyle(' color:red ;; x ; width:expression(1) ')
    expect(once).toBe('color:red')
    expect(sanitizeInlineStyle(once)).toBe(once)
    expect(sanitizeInlineStyle('width:expression(1)')).toBeNull()
  })
})

describe('sanitizeStyleSheet', () => {
  it('removes @import and unsafe declarations but keeps formatting of the rest', () => {
    const css = '@import url(https://evil/x.css);\n.card {\n  color: red;\n  background: url(http://t/x.png);\n  padding: 4px\n}\n'
    expect(sanitizeStyleSheet(css)).toBe('\n.card {\n  color: red;\n  padding: 4px\n}\n')
  })

  it('checks declarations inside @media and @font-face too', () => {
    const css =
      '@media (max-width: 600px){.a{width:expression(1);color:red}}@font-face{font-family:x;src:url(http://t/f.woff)}'
    expect(sanitizeStyleSheet(css)).toBe('@media (max-width: 600px){.a{color:red}}@font-face{font-family:x;}')
  })

  it('neutralizes closing tags that would end the style block or the HTML block', () => {
    const css = '.a::after{content:"</style><script>x</script></pre>"}'
    const out = sanitizeStyleSheet(css)
    expect(out).not.toMatch(/<\/(style|script|pre)/i)
    expect(out).toContain('<\\/style>')
  })

  it('ignores ; { } inside strings and comments', () => {
    const css = '/* a; b { */ .a{content:"x;}{"; color:red}'
    expect(sanitizeStyleSheet(css)).toBe(css)
  })

  it('is idempotent', () => {
    const css = '@import "x.css";\n.a{color:red;behavior:url(x)}\n@keyframes k{from{opacity:0}to{opacity:1}}</style>'
    const once = sanitizeStyleSheet(css)
    expect(sanitizeStyleSheet(once)).toBe(once)
  })

  // 페이지 스타일은 익명 공개 공유 방문자에게도 적용된다 — 외부 주소 요청(추적·속성 선택자 유출)은 data:image/ 밖 모두 막는다.
  it('allows only data:image/ urls in the page stylesheet (https declarations and @font-face src are dropped)', () => {
    const css =
      '.a{background:url(https://t.example/a.png);color:red}[value^="a"]{background-image:url("https://t.example/?a")}' +
      '.b{background:url(data:image/png;base64,AA==)}@font-face{font-family:f;src:url(https://t.example/f.woff2)}'
    expect(sanitizeStyleSheet(css)).toBe(
      '.a{color:red}[value^="a"]{}.b{background:url(data:image/png;base64,AA==)}@font-face{font-family:f;}',
    )
  })

  // 브라우저는 at-rule 이름의 이스케이프를 풀어 읽는다 — 놓치면 안쪽 규칙이 범위 접두 없이 앱 전체에 적용된다.
  it('drops at-rule blocks whose name is escaped or unknown, with everything inside', () => {
    const seen: string[] = []
    const out = sanitizeStyleSheet(
      '@\\6d edia all { body{display:none} } @me/**/dia all{ p{x:1} } @foo x { .y{a:1} } @\\69mport "https://e/x.css"; .a{color:red}',
      (p) => {
        seen.push(p.trim())
        return p
      },
    )
    expect(out).toBe(' .a{color:red}')
    expect(seen).toEqual(['.a'])
    expect(sanitizeStyleSheet(out)).toBe(out)
  })

  it('drops nested rules inside style rules (nested selectors would not get the scope prefix)', () => {
    const seen: string[] = []
    const out = sanitizeStyleSheet('.a{color:red; :not(&){display:none} & ~ p{x:1} @media print{ b{c:d} } padding:4px}', (p) => {
      seen.push(p.trim())
      return p
    })
    expect(out).toBe('.a{color:red; padding:4px}')
    expect(seen).toEqual(['.a'])
  })

  // url(…) 은 따옴표가 없으면 다음 ')' 까지가 토큰 하나다(괄호·따옴표가 뜻이 없다). 괄호 깊이로 세면 뒤의 } 를 놓쳐
  // body{…} 가 선언 글자로 통째로 남고, 브라우저는 그것을 최상위 규칙으로 읽는다.
  it('reads unquoted url() as one token so a stray ( or " inside cannot hide the end of the block', () => {
    const seen: string[] = []
    sanitizeStyleSheet('.a{background:url(data:image/png(") } body{display:none}', (p) => {
      seen.push(p.trim())
      return p
    })
    expect(seen).toEqual(['.a', 'body'])
    // 따옴표 든 url("…") 과 #url( 은 일반 괄호다.
    expect(sanitizeStyleSheet('.a{background:url("data:image/png;x)"); color:red}')).toBe(
      '.a{background:url("data:image/png;x)"); color:red}',
    )
  })

  it('hands only plain style-rule selectors to the rewriter', () => {
    const seen: string[] = []
    sanitizeStyleSheet('.a{x:1} @media print{ body{x:1} } @keyframes k{ from{x:0} } @font-face{font-family:f}', (p) => {
      seen.push(p.trim())
      return p
    })
    expect(seen).toEqual(['.a', 'body'])
  })
})

describe('escapeHtmlAttr', () => {
  it('escapes quotes, ampersands, angle brackets and pipes', () => {
    expect(escapeHtmlAttr(`a"b&c<d>'|`)).toBe(`a&quot;b&amp;c&lt;d&gt;'&#124;`)
  })
})
