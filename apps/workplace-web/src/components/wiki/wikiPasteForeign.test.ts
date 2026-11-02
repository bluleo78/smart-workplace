// @vitest-environment jsdom
// WP-1306 — 노트 밖 HTML 붙여넣기 「모양 유지」 정리기. 거를 목록(글꼴·크기·여백·mso-*·무채색 기본 글자색 등)과 남길 목록(상자 배경·테두리·
// 모서리·여백·그림자, 글 밑줄·글자색·배경색)을 순수 함수로 고정하고, 실제 붙여넣기 경로(transformPastedHTML → 파싱 → transformPasted)로
// 웹 카드·Google Docs·Word 표본이 어떤 노트가 되는지 본다.
import { docToMarkdown, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import { type Node as PMNode } from '@tiptap/pm/model'
import { afterEach, describe, expect, it } from 'vitest'

import { parseCssColor } from '@/lib/cssColor'

import { WikiHtmlScope } from './wikiHtmlScope'
import {
  filterForeignBoxStyle,
  filterForeignSpanStyle,
  isNeutralColor,
  prepareForeignHtml,
} from './wikiPasteForeign'
import { WikiPasteShape } from './wikiPasteShape'

describe('isNeutralColor', () => {
  it('treats black, grays, slate body text and white as neutral; brand colors as chromatic', () => {
    for (const c of ['#000000', 'rgb(33, 37, 41)', '#334155', '#0f172a', '#6b7280', '#e2e8f0', '#f3f4f6', '#ffffff']) {
      expect(isNeutralColor(parseCssColor(c)!), c).toBe(true)
    }
    // 옅은 형광펜·배지 바탕(#dcfce7·#fee2e2·#fef08a)은 밝아도 색이다.
    for (const c of ['#2563eb', '#dc2626', 'rgb(22, 163, 74)', '#1F3864', '#dcfce7', '#fee2e2', '#fef08a']) {
      expect(isNeutralColor(parseCssColor(c)!), c).toBe(false)
    }
  })
})

describe('filterForeignSpanStyle — the inline filter list', () => {
  const span = (style: string, inside = false) =>
    filterForeignSpanStyle(
      style.split(';').filter((d) => d.includes(':')).map((d) => d.split(':').map((x) => x.trim()) as [string, string]),
      inside,
    )

  it('drops Google Docs noise — font, size, weight, black color, transparent background, white-space, vertical-align', () => {
    expect(
      span(
        'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap',
      ),
    ).toBeNull()
  })

  it('drops Word noise — mso-*, windowtext, font sizes — but keeps a real theme color', () => {
    expect(span("font-size:12.0pt;mso-ascii-font-family:Calibri;mso-fareast-language:KO;color:windowtext")).toBeNull()
    expect(span('font-size:12.0pt;color:#2F5496;mso-themecolor:accent1')).toBe('color: #2F5496')
  })

  it('keeps underline, chromatic text color and chromatic highlight; normalizes the underline value', () => {
    expect(span('text-decoration: underline solid rgb(0, 0, 0); color: rgb(220, 38, 38); background-color: rgb(254, 240, 138)')).toBe(
      'text-decoration: underline; color: rgb(220, 38, 38); background-color: rgb(254, 240, 138)',
    )
  })

  it('drops neutral text color and neutral (page) background unless the text sits on a kept background', () => {
    expect(span('color: rgb(33, 37, 41); background-color: rgb(255, 255, 255)')).toBeNull()
    // 배경 상자 안이면 그 배경에 맞춘 글자색이라 남긴다.
    expect(span('color: rgb(255, 255, 255)', true)).toBe('color: rgb(255, 255, 255)')
    // 글 자신이 유채색 배경을 지니면 무채색 글자색도 남긴다(노란 형광펜 위 검정 글자 — 어두운 테마에서도 읽힌다).
    expect(span('color: #111; background: #fef08a')).toBe('color: #111; background-color: #fef08a')
  })

  it('drops values that cannot resolve here — outer CSS variables, inherit, currentColor, gradients on text', () => {
    expect(span('color: var(--brand); background: linear-gradient(red, blue)')).toBeNull()
    expect(span('color: inherit')).toBeNull()
    expect(span('color: currentColor')).toBeNull()
    expect(span('color: transparent; background-color: Transparent')).toBeNull()
  })

  it('the inner span wins over the outer one (declarations in outer → inner order)', () => {
    expect(span('color: rgb(220, 38, 38); color: rgb(22, 101, 52)')).toBe('color: rgb(22, 101, 52)')
  })
})

describe('filterForeignBoxStyle — the container filter list', () => {
  it('keeps a web card as a box — background, border, radius, padding, shadow — and drops layout/font noise', () => {
    const out = filterForeignBoxStyle(
      'display: flex; width: 320px; margin: 0px 0px 16px; font-family: Inter, sans-serif; font-size: 15px; line-height: 1.6; background-color: rgb(239, 246, 255); border: 1px solid rgb(191, 219, 254); border-radius: 12px; padding: 16px; box-shadow: rgba(0, 0, 0, 0.1) 0px 1px 3px; color: rgb(30, 64, 175)',
    )
    expect(out.visible).toBe(true)
    expect(out.style).toBe(
      'background-color: rgb(239, 246, 255); color: rgb(30, 64, 175); border: 1px solid rgb(191, 219, 254); border-radius: 12px; padding: 16px; box-shadow: rgba(0, 0, 0, 0.1) 0px 1px 3px',
    )
  })

  it('adds a readable text color to a background box without one (light → dark text, dark → light text)', () => {
    expect(filterForeignBoxStyle('background: #eff6ff; padding: 8px').style).toBe('background-color: #eff6ff; color: #111827; padding: 8px')
    expect(filterForeignBoxStyle('background-color: rgb(15, 23, 42)').style).toBe('background-color: rgb(15, 23, 42); color: #f9fafb')
    // 배경 상자의 무채색 글자색은 그 배경에 맞춘 것이라 남긴다.
    expect(filterForeignBoxStyle('background-color: rgb(15, 23, 42); color: rgb(255, 255, 255)').style).toBe(
      'background-color: rgb(15, 23, 42); color: rgb(255, 255, 255)',
    )
  })

  it('a container with only padding/margin, a page-white background or an invisible border is not a box', () => {
    expect(filterForeignBoxStyle('padding: 8px; margin: 4px').visible).toBe(false)
    expect(filterForeignBoxStyle('background-color: rgb(255, 255, 255); padding: 8px').visible).toBe(false)
    expect(filterForeignBoxStyle('background: transparent; border: 0px none rgb(0, 0, 0)').visible).toBe(false)
    expect(filterForeignBoxStyle('border-width: 0px; border-style: solid; box-shadow: none').visible).toBe(false)
    // 투명 선(자리만 잡는 테두리)은 보이는 테두리가 아니다.
    expect(filterForeignBoxStyle('border: 1px solid transparent; padding: 8px').visible).toBe(false)
    // 배경 이미지(url)는 들이지 않는다.
    expect(filterForeignBoxStyle('background: url(https://x.test/a.png) no-repeat').visible).toBe(false)
  })

  it('a shadow-only or border-only card stays a box, and an unwrapped container hands down only a chromatic color', () => {
    expect(filterForeignBoxStyle('box-shadow: 0 1px 2px rgba(0,0,0,.2); border-radius: 8px').style).toBe(
      'box-shadow: 0 1px 2px rgba(0,0,0,.2); border-radius: 8px',
    )
    expect(filterForeignBoxStyle('border-left: 4px solid #3b82f6; padding-left: 12px').style).toBe(
      'border-left: 4px solid #3b82f6; padding-left: 12px',
    )
    expect(filterForeignBoxStyle('color: #dc2626; padding: 4px')).toMatchObject({ visible: false, color: '#dc2626' })
    // 가로 속성은 네 변을 다 본다 — 아래 변만 그은 카드도 상자다.
    expect(filterForeignBoxStyle('border-width: 0 0 2px; border-style: solid; border-color: #3b82f6').visible).toBe(true)
    expect(filterForeignBoxStyle('color: #333; padding: 4px')).toMatchObject({ visible: false, color: null })
  })
})

describe('prepareForeignHtml', () => {
  it('turns <u>, <font color> and colored paragraphs into spans the shape filter can read', () => {
    const out = prepareForeignHtml('<p style="color: red; margin: 0">a <u>b</u> <font color="#2563eb">c</font></p>')
    expect(out).toContain('<p style="color: red; margin: 0"><span style="color: red">a <span style="text-decoration: underline">b</span>')
    expect(out).toContain('<span style="color: #2563eb">c</span>')
  })

  it('returns plain HTML untouched', () => {
    expect(prepareForeignHtml('<p>그냥 <b>글</b></p>')).toBe('<p>그냥 <b>글</b></p>')
  })
})

describe('pasting foreign HTML keeps the shape (WP-1306)', () => {
  const editors: Editor[] = []
  afterEach(() => {
    editors.splice(0).forEach((e) => e.destroy())
  })
  const pasteEvent = () => new Event('paste') as unknown as ClipboardEvent

  function pasted(html: string): { doc: PMNode; md: string; editor: Editor } {
    const editor = new Editor({ element: document.createElement('div'), extensions: [...wikiSchemaExtensions(), WikiHtmlScope, WikiPasteShape] })
    editors.push(editor)
    editor.view.pasteHTML(html, pasteEvent())
    return { doc: editor.state.doc, md: docToMarkdown(editor.state.doc), editor }
  }

  // 웹 페이지에서 끌어 복사한 카드 — 브라우저가 페이지 CSS 로 정한 모양을 인라인 style 로 싣고, 전역 <style> 도 딸려 올 수 있다.
  const WEB_CARD = [
    '<style>.card{background:red} body{display:none}</style>',
    '<div class="card" style="background-color: rgb(239, 246, 255); border-radius: 12px; padding: 16px; margin: 0px 0px 16px; font-family: Inter, sans-serif; font-size: 15px; color: rgb(30, 41, 59);">',
    '<h3 style="margin: 0px; font-size: 18px;">분기 요약</h3>',
    '<p style="color: rgb(220, 38, 38); line-height: 1.6;">매출 <span class="badge" style="background-color: rgb(220, 252, 231); color: rgb(22, 101, 52); font-size: 12px;">좋음</span></p>',
    '</div>',
    '<p style="color: rgb(33, 37, 41); font-family: Georgia;">본문 글</p>',
  ].join('')

  it('a web card with a background becomes a box, colored text becomes a format span, and the global <style> and classes are dropped', () => {
    const { doc, md, editor } = pasted(WEB_CARD)
    expect(md).toContain('<div style="background-color: rgb(239, 246, 255); color: rgb(30, 41, 59); border-radius: 12px; padding: 16px">')
    expect(md).toContain('### 분기 요약')
    // 문단 글자색은 span 으로 내려오고, 배지는 바깥 글자색 위에 자기 색·배경으로 하나의 서식 span 이 된다.
    expect(md).toContain(
      '<span style="color: rgb(220, 38, 38)">매출 </span><span style="color: rgb(22, 101, 52); background-color: rgb(220, 252, 231)">좋음</span>',
    )
    // 페이지 본문 글자색(무채색)·글꼴은 버린다.
    expect(md).toContain('\n본문 글')
    for (const noise of ['class=', 'font-family', 'font-size', 'margin', 'line-height', 'data-wp-style', 'display:none']) expect(md).not.toContain(noise)
    let styles = 0
    doc.descendants((n) => {
      if (n.type.name === 'wikiStyle') styles++
    })
    expect(styles).toBe(0)
    // 상자가 있으니 범위 가두기(contain)가 켜진다 — 노트끼리 복사한 상자와 같다.
    expect(editor.view.dom.classList.contains('wiki-html-scope')).toBe(true)
  })

  it('Google Docs HTML brings no font/size/color noise — the same as the text-only result', () => {
    const { md, doc } = pasted(
      [
        '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc">',
        '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">보고서 </span>',
        '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:700;">굵게</span>',
        '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#1155cc;text-decoration:underline;">밑줄 파랑</span></p>',
        '</b>',
      ].join(''),
    )
    expect(md).toBe('보고서 **굵게**<span style="text-decoration: underline; color: #1155cc">밑줄 파랑</span>')
    let boxes = 0
    doc.descendants((n) => {
      if (n.type.name === 'wikiHtmlBox') boxes++
    })
    expect(boxes).toBe(0)
  })

  it('Word HTML drops MsoNormal classes, mso-* and font sizes, keeps <u> underline and the theme color', () => {
    const { md } = pasted(
      [
        '<p class=MsoNormal style=\'margin:0cm;font-size:11.0pt;font-family:"맑은 고딕"\'><span lang=EN-US style=\'font-size:12.0pt;mso-ascii-font-family:Calibri;color:black\'>보고 </span>',
        "<u><span style='color:#2F5496;mso-themecolor:accent1'>강조</span></u><o:p></o:p></p>",
      ].join(''),
    )
    expect(md).toBe('보고 <span style="text-decoration: underline; color: #2F5496">강조</span>')
  })
})
