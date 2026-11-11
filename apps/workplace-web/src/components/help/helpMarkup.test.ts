// 도움말 조건 블록·자리표시 처리(WP-1505) — 매뉴얼 쪽 규칙(docs/manual/scripts/lib/help-markup.mjs)과 같은 결과인지 본다.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { describe, expect, it } from 'vitest'

import type { HelpVars } from './helpBundle'
import { applyHelpConditions, fillHelpSnippet, remarkHelpPlaceholders } from './helpMarkup'

const vars: HelpVars = {
  placeholders: [
    { name: 'agent.username', display: 'AI 아이디', description: '' },
    { name: 'app.origin', display: '앱 주소', description: '' },
  ],
  conditions: [{ name: 'app.customMcpServer', tag: '(기본 주소가 아닌 서버만)', description: '' }],
}

describe('applyHelpConditions', () => {
  it('조건 true 면 표기만 지운다 — 목록 밖 표기 줄은 빈 줄로 남아 문단이 나뉜다(PDF 와 같다)', () => {
    expect(applyHelpConditions('a\n{if app.customMcpServer}\nb\n{/if}\nc', { 'app.customMcpServer': true }, vars)).toBe('a\n\nb\n\nc')
  })

  it('조건 false 면 블록째 지운다', () => {
    expect(applyHelpConditions('1. 하나\n{if app.customMcpServer}\n2. 둘\n{/if}\n3. 셋', { 'app.customMcpServer': false }, vars)).toBe(
      '1. 하나\n3. 셋',
    )
  })

  it('값이 없으면 꼬리표를 다음 목록 항목 앞에', () => {
    expect(applyHelpConditions('1. 하나\n{if app.customMcpServer}\n2. 둘\n{/if}', {}, vars)).toBe('1. 하나\n2. *(기본 주소가 아닌 서버만)* 둘\n')
  })

  it('값이 없고 다음 줄이 목록이 아니면 꼬리표를 앞뒤 빈 줄을 둔 문단으로', () => {
    expect(applyHelpConditions('a\n{if app.customMcpServer}\nb\n{/if}', {}, vars)).toBe('a\n\n*(기본 주소가 아닌 서버만)*\n\nb\n')
  })

  it('목록에 없는 조건은 이름을 꼬리표로, manual-vars 가 없어도 같다', () => {
    expect(applyHelpConditions('{if x.y}\nb\n{/if}', {}, vars)).toBe('\n*(x.y)*\n\nb\n')
    expect(applyHelpConditions('{if app.customMcpServer}\nb\n{/if}', {}, null)).toBe('\n*(app.customMcpServer)*\n\nb\n')
  })

  it('한 줄 안 조건', () => {
    expect(applyHelpConditions('앞 {if app.customMcpServer}가운데{/if} 뒤', { 'app.customMcpServer': false }, vars)).toBe('앞  뒤')
    expect(applyHelpConditions('앞 {if app.customMcpServer}가운데{/if} 뒤', { 'app.customMcpServer': true }, vars)).toBe('앞 가운데 뒤')
    expect(applyHelpConditions('앞 {if app.customMcpServer}가운데{/if} 뒤', {}, vars)).toBe('앞 *(기본 주소가 아닌 서버만)* 가운데 뒤')
  })

  it('false 블록 안의 코드 펜스도 함께 지운다', () => {
    const md = 'a\n{if app.customMcpServer}\n```\nx\n```\n{/if}\nb'
    expect(applyHelpConditions(md, { 'app.customMcpServer': false }, vars)).toBe('a\n\nb')
  })

  it('코드 펜스·인라인 코드·HTML 주석 안 조건 표기는 그대로', () => {
    const fence = '```\n{if app.customMcpServer}\nx\n{/if}\n```'
    expect(applyHelpConditions(fence, { 'app.customMcpServer': false }, vars)).toBe(fence)
    const tilde = '~~~\n```\n{if app.customMcpServer}\n~~~'
    expect(applyHelpConditions(tilde, { 'app.customMcpServer': false }, vars)).toBe(tilde)
    expect(applyHelpConditions('글 `{if app.customMcpServer}` 끝', { 'app.customMcpServer': false }, vars)).toBe('글 `{if app.customMcpServer}` 끝')
    expect(applyHelpConditions('글 <!-- {if app.customMcpServer} --> 끝', { 'app.customMcpServer': false }, vars)).toBe(
      '글 <!-- {if app.customMcpServer} --> 끝',
    )
  })

  it('$·\\ 바로 뒤 중괄호는 표기가 아니다', () => {
    expect(applyHelpConditions('${if a.b} \\{/if}', { 'a.b': false }, vars)).toBe('${if a.b} \\{/if}')
  })

  // 줄 단위 표기 줄은 「앞줄이 목록 문맥이고 다음 줄이 목록 항목」일 때만 지우고 아니면 빈 줄로 남긴다(help-markup.mjs neighbor·inList).
  // 늘 지우면 `{/if}` 뒤 문단이 목록 항목의 연속줄로 붙거나 앞뒤 문단이 한 문단으로 이어져 PDF 와 구조가 달라진다.
  describe('줄 단위 표기 줄의 경계는 PDF 와 같다', () => {
    const listThenPara = '1. 하나\n{if app.customMcpServer}\n2. 둘\n{/if}\n다음 문단.'
    const paraAround = '앞 문단.\n{if app.customMcpServer}\n안 문단.\n{/if}\n뒤 문단.'
    const tag = '*(기본 주소가 아닌 서버만)*'
    /** 조건을 처리한 뒤 react-markdown 으로 그린 HTML(줄바꿈 제거) — 블록 구조를 본다. */
    const html = (md: string, v: boolean | undefined) =>
      renderToStaticMarkup(createElement(Markdown, null, applyHelpConditions(md, { 'app.customMcpServer': v }, vars))).replace(/\n/g, '')

    it('목록 뒤 문단 — 값 모름·true·false 모두 문단이 목록 밖 별도 문단', () => {
      expect(applyHelpConditions(listThenPara, {}, vars)).toBe(`1. 하나\n2. ${tag} 둘\n\n다음 문단.`)
      expect(applyHelpConditions(listThenPara, { 'app.customMcpServer': true }, vars)).toBe('1. 하나\n2. 둘\n\n다음 문단.')
      expect(applyHelpConditions(listThenPara, { 'app.customMcpServer': false }, vars)).toBe('1. 하나\n\n다음 문단.')
      expect(html(listThenPara, undefined)).toBe('<ol><li>하나</li><li><em>(기본 주소가 아닌 서버만)</em> 둘</li></ol><p>다음 문단.</p>')
      expect(html(listThenPara, true)).toBe('<ol><li>하나</li><li>둘</li></ol><p>다음 문단.</p>')
      expect(html(listThenPara, false)).toBe('<ol><li>하나</li></ol><p>다음 문단.</p>')
    })

    it('문단 사이 — 값 모름·true·false 모두 문단이 나뉜다', () => {
      expect(applyHelpConditions(paraAround, {}, vars)).toBe(`앞 문단.\n\n${tag}\n\n안 문단.\n\n뒤 문단.`)
      expect(applyHelpConditions(paraAround, { 'app.customMcpServer': true }, vars)).toBe('앞 문단.\n\n안 문단.\n\n뒤 문단.')
      expect(applyHelpConditions(paraAround, { 'app.customMcpServer': false }, vars)).toBe('앞 문단.\n\n뒤 문단.')
      expect(html(paraAround, undefined)).toBe('<p>앞 문단.</p><p><em>(기본 주소가 아닌 서버만)</em></p><p>안 문단.</p><p>뒤 문단.</p>')
      expect(html(paraAround, true)).toBe('<p>앞 문단.</p><p>안 문단.</p><p>뒤 문단.</p>')
      expect(html(paraAround, false)).toBe('<p>앞 문단.</p><p>뒤 문단.</p>')
    })
  })

  // HTML 주석 판정은 help-markup.mjs splitProseLines 의 closable 과 같다 — 줄 첫머리 `<!--` 는 빈 줄을 넘어 닫혀도 주석,
  // 줄 가운데 `<!--` 는 같은 문단(빈 줄 전) 안에서 닫혀야 주석이다. 아니면 글자라 그 뒤 표기는 조건 표기다.
  it('줄 가운데 <!-- 가 빈 줄 뒤에서야 닫히면 주석이 아니다', () => {
    expect(applyHelpConditions('글 <!-- {if app.customMcpServer}가운데{/if}\n\n뒤 -->', { 'app.customMcpServer': false }, vars)).toBe(
      '글 <!-- \n\n뒤 -->',
    )
    const block = '<!-- {if app.customMcpServer}가운데{/if}\n\n뒤 -->'
    expect(applyHelpConditions(block, { 'app.customMcpServer': false }, vars)).toBe(block)
  })
})

/** react-markdown 에 플러그인을 끼워 정적 HTML 로 — 화면이 쓰는 것과 같은 길로 본다. */
function render(md: string, values: Record<string, string | undefined>, v: HelpVars | null = vars): string {
  return renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm, remarkHelpPlaceholders({ values, vars: v })] }, md),
  )
}

describe('remarkHelpPlaceholders', () => {
  it('산문·인라인 코드·코드 블록의 자리표시를 값으로', () => {
    const html = render('{agent.username} `{agent.username}`\n\n```\n/gw:as {agent.username}\n```', { 'agent.username': 'dev5' })
    expect(html.match(/dev5/g)).toHaveLength(3)
    expect(html).not.toContain('{agent.username}')
    expect(html).toContain('/gw:as dev5')
  })

  it('링크 주소의 자리표시도 바꾼다', () => {
    const html = render('[마켓](<{app.origin}/claude/marketplace.json>)', { 'app.origin': 'https://w.example' })
    expect(html).toContain('href="https://w.example/claude/marketplace.json"')
  })

  it('값이 없으면 <AI 아이디>', () => {
    const html = render('{agent.username} `{agent.username}`', {})
    expect(html).toContain('&lt;AI 아이디&gt; <code>&lt;AI 아이디&gt;</code>')
  })

  it('목록 밖 이름·$·\\ 앞은 그대로', () => {
    expect(render('{props.title} ${app.origin}', { 'app.origin': 'X' })).toBe('<p>{props.title} ${app.origin}</p>')
    expect(render('\\{app.origin} 끝', { 'app.origin': 'X' })).toBe('<p>{app.origin} 끝</p>')
    expect(render('```\n{props.title} ${app.origin}\n```', { 'app.origin': 'X' })).toContain('{props.title} ${app.origin}')
  })

  // 원문 탈출 판정(escapedFlags) — PDF 는 원문 글자로 표기를 찾으므로 `\{`·문자 참조로 쓴 중괄호는 글자로 남는다.
  it('여러 줄 인용의 \\{ 는 글자로 남는다(> 표지를 건너뛰고 원문을 맞춘다)', () => {
    const html = render('> 가 \\{app.origin}\n> 나 {app.origin}', { 'app.origin': 'X' })
    expect(html).toContain('가 {app.origin}')
    expect(html).toContain('나 X')
  })

  it('문자 참조 뒤의 \\{ 도 글자로 남는다', () => {
    expect(render('&amp; {app.origin} \\{app.origin}', { 'app.origin': 'X' })).toBe('<p>&amp; X {app.origin}</p>')
  })

  it('문자 참조로 쓴 중괄호는 표기가 아니다', () => {
    expect(render('&#123;app.origin} 끝', { 'app.origin': 'X' })).toBe('<p>{app.origin} 끝</p>')
    expect(render('{app.origin&#125; 끝', { 'app.origin': 'X' })).toBe('<p>{app.origin} 끝</p>')
  })

  it('값은 markdown 으로 해석되지 않는다', () => {
    const html = render('아이디 {agent.username} 끝', { 'agent.username': '**x**[y](z)' })
    expect(html).toBe('<p>아이디 **x**[y](z) 끝</p>')
  })

  it('manual-vars 를 못 받으면 산문은 이름 그대로 <name>, 코드는 값이 있는 이름만', () => {
    expect(render('{agent.username}', {}, null)).toBe('<p>&lt;agent.username&gt;</p>')
    expect(render('`{app.origin}` `{props.title}`', { 'app.origin': 'X' }, null)).toBe('<p><code>X</code> <code>{props.title}</code></p>')
  })
})

describe('fillHelpSnippet', () => {
  it('자리표시를 값으로 채우고, 값이 없으면 `<표시 이름>` 꼴', () => {
    const values = { placeholders: { 'agent.username': 'bot1' }, conditions: {} }
    expect(fillHelpSnippet('아이디는 {agent.username}, 주소는 {app.origin}.', values, vars)).toBe('아이디는 bot1, 주소는 <앱 주소>.')
  })

  it('목록 밖 이름·탈출한 중괄호는 그대로', () => {
    const values = { placeholders: {}, conditions: {} }
    expect(fillHelpSnippet('{props.title} ${agent.username}', values, vars)).toBe('{props.title} ${agent.username}')
  })
})
