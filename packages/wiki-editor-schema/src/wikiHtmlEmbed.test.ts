// WP-1242 — HTML 블록(```html-embed 펜스) 라운드트립. 저장 형식이 md → doc → md 로 안정적이고, 소스 글자(빈 줄·백틱·</script>)가
// 한 글자도 바뀌지 않으며, 일반 ```html 코드 블록은 지금처럼 codeBlock 으로 남아야 한다.
import { describe, expect, it } from 'vitest'

import { htmlEmbedFence } from './htmlEmbedNode'
import { docToMarkdown, markdownToDoc } from './markdown'

/** 한 번 저장한 결과와 그것을 다시 열어 저장한 결과 — 두 번째부터 같아야 한다. */
function roundtrip(md: string): { once: string; twice: string } {
  const once = docToMarkdown(markdownToDoc(md))
  return { once, twice: docToMarkdown(markdownToDoc(once)) }
}

/** 문서 맨 앞 블록의 종류와 글자. */
function firstBlock(md: string): { type: string; text: string } {
  const node = markdownToDoc(md).firstChild!
  return { type: node.type.name, text: node.textContent }
}

const CHART = [
  '<canvas id="c" width="400" height="200"></canvas>',
  '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>',
  '<script>',
  "new Chart(document.getElementById('c'), { type: 'bar', data: { labels: ['a'], datasets: [{ data: [1] }] } })",
  '</script>',
].join('\n')

describe('HTML 블록 (WP-1242)', () => {
  it('```html-embed 펜스를 wikiHtmlEmbed 로 읽고 바이트 그대로 저장한다', () => {
    const md = ['# 차트', '', '```html-embed', CHART, '```', '', '뒤 문단'].join('\n')
    const doc = markdownToDoc(md)
    expect(doc.child(1).type.name).toBe('wikiHtmlEmbed')
    expect(doc.child(1).textContent).toBe(CHART)
    expect(docToMarkdown(doc)).toBe(md)
  })

  it('일반 ```html 코드 블록과 정보 문자열 없는 펜스는 codeBlock 그대로다', () => {
    expect(firstBlock('```html\n<b>x</b>\n```')).toEqual({ type: 'codeBlock', text: '<b>x</b>' })
    expect(firstBlock('```\n<b>x</b>\n```')).toEqual({ type: 'codeBlock', text: '<b>x</b>' })
    expect(roundtrip('```html\n<b>x</b>\n```').once).toBe('```html\n<b>x</b>\n```')
  })

  it('빈 줄·앞뒤 공백·탭·</script>·HTML 엔티티 글자가 그대로다', () => {
    const src = ['  <div>', '', '', '\t<p>&amp; &lt;b&gt;</p>', '<script>var s = "</scr" + "ipt>"</script>', '</script>', '   '].join('\n')
    const md = '```html-embed\n' + src + '\n```'
    expect(firstBlock(md)).toEqual({ type: 'wikiHtmlEmbed', text: src })
    const { once, twice } = roundtrip(md)
    expect(once).toBe(md)
    expect(twice).toBe(once)
  })

  it('소스 앞뒤 빈 줄도 왕복에서 남는다', () => {
    const src = '\n<b>x</b>\n\n'
    const md = '```html-embed\n' + src + '\n```'
    expect(firstBlock(md).text).toBe(src)
    expect(roundtrip(md).once).toBe(md)
  })

  it('소스에 ``` 가 있으면 더 긴 펜스로 저장해 블록이 중간에 닫히지 않는다', () => {
    const src = ['<script>', 'const md = `', '```js', 'x', '```', '`', '</script>', '<pre>````</pre>'].join('\n')
    const doc = markdownToDoc('````html-embed\n' + 'placeholder' + '\n````')
    expect(doc.firstChild!.type.name).toBe('wikiHtmlEmbed')
    // 문서를 직접 만들어 저장 — 펜스가 소스의 가장 긴 백틱 연속(4)보다 길어야 한다.
    const schema = doc.type.schema
    const built = schema.node('doc', null, [schema.node('wikiHtmlEmbed', null, [schema.text(src)])])
    const md = docToMarkdown(built)
    expect(md.startsWith('`````html-embed\n')).toBe(true)
    expect(md.endsWith('\n`````')).toBe(true)
    const reread = markdownToDoc(md)
    expect(reread.childCount).toBe(1)
    expect(reread.firstChild!.type.name).toBe('wikiHtmlEmbed')
    expect(reread.firstChild!.textContent).toBe(src)
    expect(docToMarkdown(reread)).toBe(md)
  })

  it('빈 HTML 블록도 왕복한다', () => {
    const md = '```html-embed\n\n```'
    expect(firstBlock(md)).toEqual({ type: 'wikiHtmlEmbed', text: '' })
    expect(roundtrip(md).once).toBe(md)
  })

  it('목록·인용 안 HTML 블록은 들여쓰기를 유지하고 소스는 그대로다', () => {
    const md = ['- 항목', '', '  ```html-embed', '  <b>x</b>', '', '  <i>y</i>', '  ```'].join('\n')
    const { once, twice } = roundtrip(md)
    // 빈 줄에도 목록 들여쓰기가 붙는다(코드 블록 직렬화와 같다) — 다시 읽으면 들여쓰기는 떼여 소스는 같고, 두 번째부터 바이트가 같다.
    expect(once).toBe(['- 항목', '', '  ```html-embed', '  <b>x</b>', '  ', '  <i>y</i>', '  ```'].join('\n'))
    expect(twice).toBe(once)
    expect(markdownToDoc(once).firstChild!.firstChild!.child(1).textContent).toBe('<b>x</b>\n\n<i>y</i>')
    const item = markdownToDoc(md).firstChild!.firstChild!
    expect(item.child(1).type.name).toBe('wikiHtmlEmbed')
    expect(item.child(1).textContent).toBe('<b>x</b>\n\n<i>y</i>')

    const quote = ['> ```html-embed', '> <b>x</b>', '> ```'].join('\n')
    expect(roundtrip(quote).once).toBe(quote)
  })

  it('안 글자에는 마크·서식이 붙지 않는다(**·<b> 도 글자)', () => {
    const md = '```html-embed\n**굵게** <b>b</b> [a](b)\n```'
    const node = markdownToDoc(md).firstChild!
    expect(node.textContent).toBe('**굵게** <b>b</b> [a](b)')
    node.descendants((n) => {
      expect(n.marks).toEqual([])
    })
  })

  it('htmlEmbedFence — 최소 3개, 가장 긴 백틱 연속보다 하나 길게', () => {
    expect(htmlEmbedFence('')).toBe('```')
    expect(htmlEmbedFence('a `b` c')).toBe('```')
    expect(htmlEmbedFence('```')).toBe('````')
    expect(htmlEmbedFence('`` ```` `')).toBe('`````')
  })
})
