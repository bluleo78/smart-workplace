// WP-1305 — 선택 서식 도구의 저장 형식 라운드트립.
// - 밑줄·글자색·배경색: 새 스키마 없이 인라인 모양 마크(wikiHtmlSpan, class 없는 <span style>) 하나에 선언을 모아 쓴다.
// - 문단·제목 정렬: textAlign 속성 → GitHub 관례 <div align="…"> 감싸개(안쪽은 마크다운). 같은 정렬 이웃은 한 감싸개로 묶는다.
// md → doc → md 가 두 번째 저장부터 바이트 같고(첫 저장이 정규형), 속성이 보존되며, 모르는 값·위험 값은 버려지는지 본다.
import { getHTMLFromFragment } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { docToMarkdown, getMarkdownSchema, markdownToDoc } from './markdown'

/** 저장 → 다시 읽기 → 저장이 같은지(정규형) 보고 첫 저장 결과를 돌려준다. */
function stable(md: string): string {
  const once = docToMarkdown(markdownToDoc(md))
  expect(docToMarkdown(markdownToDoc(once))).toBe(once)
  return once
}

/** 문서 최상위 블록들의 [종류, 정렬] 목록. */
function aligns(md: string): [string, unknown][] {
  const out: [string, unknown][] = []
  markdownToDoc(md).forEach((n) => out.push([n.type.name, n.attrs.textAlign ?? null]))
  return out
}

const RED = 'color: var(--wiki-text-red, #dc2626)'
const YELLOW_BG = 'background-color: var(--wiki-mark-yellow, #fef08a)'

describe('밑줄·글자색·배경색 — class 없는 wikiHtmlSpan (WP-1305)', () => {
  it('한 span 에 모은 선언(밑줄 + 글자색 + 배경색)이 그대로 라운드트립한다', () => {
    const md = `앞 <span style="text-decoration: underline; ${RED}; ${YELLOW_BG}">강조</span> 뒤`
    expect(stable(md)).toBe(md)
    const text = markdownToDoc(md).firstChild!.child(1)
    expect(text.marks.map((m) => m.toJSON())).toEqual([
      { type: 'wikiHtmlSpan', attrs: { className: null, style: `text-decoration: underline; ${RED}; ${YELLOW_BG}` } },
    ])
  })

  it('굵게·기울임·취소선·링크와 함께 써도 span 이 바깥에 남고 마크다운 서식이 깨지지 않는다', () => {
    const md = `<span style="${RED}">**굵게** *기울임* ~~취소~~ [링크](https://example.com)</span>`
    // 링크는 자기 직렬화기가 [ ] 를 바깥에 쓰므로 링크 글자의 span 만 대괄호 안으로 들어간다 — 두 번째 저장부터는 같다.
    const out = stable(md)
    expect(out).toBe(
      `<span style="${RED}">**굵게** *기울임* ~~취소~~ </span>[<span style="${RED}">링크</span>](https://example.com)`,
    )
    const marks = new Set<string>()
    markdownToDoc(out).descendants((n) => n.marks.forEach((m) => marks.add(m.type.name)))
    expect([...marks].sort()).toEqual(['bold', 'italic', 'link', 'strike', 'wikiHtmlSpan'])
  })

  it('class 를 지닌 모양 span 안에 색 span 이 겹쳐도 둘 다 남는다(중첩)', () => {
    const md = `<span class="badge"><span style="${RED}">좋음</span></span>`
    const out = stable(md)
    const marks = markdownToDoc(out).firstChild!.firstChild!.marks.map((m) => m.attrs)
    expect(marks).toContainEqual({ className: 'badge', style: null })
    expect(marks).toContainEqual({ className: null, style: RED })
  })

  it('위험한 선언은 버리고 서식 선언은 남긴다', () => {
    const out = stable(`<span style="color: red; background-image: url(javascript:alert(1))">x</span>`)
    expect(out).toBe('<span style="color: red">x</span>')
  })

  it('표 셀(GFM) 안에서도 span 이 유지된다', () => {
    const md = ['| a | b |', '| --- | --- |', `| <span style="text-decoration: underline">밑줄</span> | 2 |`].join('\n')
    expect(stable(md).trim()).toBe(md)
  })
})

describe('문단·제목 정렬 — textAlign + <div align> 감싸개 (WP-1305)', () => {
  it('가운데 문단은 <div align="center"> 로 감싸 저장하고 다시 읽으면 정렬이 돌아온다', () => {
    const md = ['<div align="center">', '', '가운데 **굵게**', '', '</div>'].join('\n')
    expect(stable(md)).toBe(md)
    expect(aligns(md)).toEqual([['paragraph', 'center']])
  })

  it('정렬 없는 문서는 감싸개 없이 기존과 바이트가 같다', () => {
    const md = ['# 제목', '', '본문', '', '- 목록'].join('\n')
    expect(stable(md)).toBe(md)
  })

  it('같은 정렬의 이웃 블록은 감싸개 하나로 묶고, 정렬이 바뀌면 새 감싸개를 연다', () => {
    const md = [
      '<div align="center">',
      '',
      '## 가운데 제목',
      '',
      '가운데 문단',
      '',
      '</div>',
      '',
      '<div align="right">',
      '',
      '오른쪽',
      '',
      '</div>',
      '',
      '왼쪽',
    ].join('\n')
    expect(stable(md)).toBe(md)
    expect(aligns(md)).toEqual([
      ['heading', 'center'],
      ['paragraph', 'center'],
      ['paragraph', 'right'],
      ['paragraph', null],
    ])
  })

  it('제목 수준은 그대로 두고 정렬만 더한다', () => {
    const doc = markdownToDoc(['<div align="right">', '', '### 셋', '', '</div>'].join('\n'))
    expect(doc.firstChild!.attrs).toEqual({ level: 3, textAlign: 'right' })
  })

  it('모르는 정렬 값(left·justify·쓰레기)은 정렬 없음으로 읽고, 글은 남는다', () => {
    for (const v of ['left', 'justify', 'x" onclick="a', '']) {
      const doc = markdownToDoc(['<div align="' + v + '">', '', '글', '', '</div>'].join('\n'))
      expect(doc.firstChild!.attrs.textAlign).toBeNull()
      expect(docToMarkdown(doc)).toBe('글')
    }
  })

  it('인용 안 문단은 정렬을 지키고 들여쓰기가 유지된다', () => {
    const quote = stable(['> <div align="right">', '>', '> 인용', '>', '> </div>'].join('\n'))
    expect(markdownToDoc(quote).firstChild!.firstChild!.attrs.textAlign).toBe('right')
  })

  it('목록 항목 안 정렬은 저장하지 않는다 — 감싸개의 빈 줄이 목록을 느슨하게 만들지 않게(canAlignIn)', () => {
    // 옛 저장본의 항목 안 감싸개는 읽되, 저장할 때 정렬을 버린다(느슨한 목록 모양은 원문 그대로).
    const loose = docToMarkdown(markdownToDoc(['- <div align="center">', '', '  항목', '', '  </div>', '', '- 다음'].join('\n')))
    expect(loose).not.toContain('<div align')

    // 촘촘한 목록의 항목에 정렬이 붙어도(붙여넣기 등) 저장본은 촘촘한 그대로다.
    const doc = markdownToDoc(['- 하나', '- 둘'].join('\n'))
    const itemParagraphPos = 2 // bulletList(0) > listItem(1) > paragraph(2)
    const json = doc.toJSON()
    json.content[0].content[0].content[0].attrs = { textAlign: 'center' }
    const aligned = getMarkdownSchema().nodeFromJSON(json)
    expect(aligned.nodeAt(itemParagraphPos)!.attrs.textAlign).toBe('center')
    const out = docToMarkdown(aligned)
    expect(out).toBe(['- 하나', '- 둘'].join('\n'))
    expect(docToMarkdown(markdownToDoc(out))).toBe(out)
  })

  it('감싸개는 바로 안쪽 블록에만 적용된다 — 감싸개 안 목록의 문단까지 번지지 않는다', () => {
    const doc = markdownToDoc(['<div align="center">', '', '- 항목', '', '</div>'].join('\n'))
    expect(doc.firstChild!.type.name).toBe('bulletList')
    expect(doc.firstChild!.firstChild!.firstChild!.attrs.textAlign).toBeNull()
  })

  it('정렬 감싸개는 모양 영역(wikiHtmlBox)으로 읽히지 않는다', () => {
    const doc = markdownToDoc(['<div align="center">', '', '글', '', '</div>'].join('\n'))
    const names: string[] = []
    doc.descendants((n) => {
      names.push(n.type.name)
    })
    expect(names).not.toContain('wikiHtmlBox')
  })

  it('모양 영역 안 정렬 문단도 라운드트립한다', () => {
    const md = ['<div class="card">', '', '<div align="center">', '', '카드 가운데', '', '</div>', '', '</div>'].join('\n')
    expect(stable(md)).toBe(md)
  })

  it('렌더 HTML(공개 공유·판 미리보기·노트끼리 복사)은 style text-align 을 쓰고, 그 HTML 을 다시 읽으면 정렬이 남는다', () => {
    const schema = getMarkdownSchema()
    const doc = markdownToDoc(['<div align="center">', '', '가운데', '', '</div>'].join('\n'))
    const html = getHTMLFromFragment(doc.content, schema)
    expect(html).toMatch(/<p style="text-align: center;?">가운데<\/p>/)
    // HTML 을 마크다운 HTML 블록으로 다시 읽는 경로(표 HTML 폴백·붙여넣기) — 자기 style 의 text-align 을 읽는다.
    expect(markdownToDoc(html).firstChild!.attrs.textAlign).toBe('center')
  })

  it('밑줄·색 span 과 정렬을 함께 써도 둘 다 남는다', () => {
    const md = ['<div align="center">', '', `<span style="text-decoration: underline; ${RED}">가운데 빨강 밑줄</span>`, '', '</div>'].join('\n')
    expect(stable(md)).toBe(md)
  })
})
