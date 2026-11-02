// WP-1304 — 상자 꾸미기의 style 글자 읽기·바꾸기(순수 함수). 미리 만든 모양 판정, 항목 하나 바꾸기(다른 선언 보존), 왕복,
// 「CSS 로 직접 고치기」 뺀 수 세기·페이지 CSS 정리(wikiStyleNode)를 본다. 저장(정리·자리 지킴)·편집기 반영·실행 취소는 WikiBoxStylePanel.test.tsx.
import { sanitizeInlineStyle } from '@smart-workplace/wiki-editor-schema'
import { describe, expect, it } from 'vitest'

import { BOX_BASIC_STYLE } from './wikiBox'
import {
  applyBoxStyle,
  BOX_BACKGROUNDS,
  BOX_COLORS,
  BOX_PRESETS,
  normalizeValue,
  parseBoxStyle,
  removedDeclCount,
  removedNote,
  styleToEditableText,
  styleToReact,
} from './wikiBoxStyle'
import { sanitizeEditedPageCss } from './wikiStyleNode'

const preset = (key: string) => BOX_PRESETS.find((p) => p.key === key)!.style

describe('parseBoxStyle — 지금 값 읽기', () => {
  it('새 상자(기본 모양)는 「기본」·얇은 테두리·둥근 모서리·보통 여백·그림자 없음·배경/글자색 없음', () => {
    expect(parseBoxStyle(BOX_BASIC_STYLE)).toEqual({
      preset: 'basic',
      background: null,
      color: null,
      border: 'thin',
      radius: 'round',
      padding: 'normal',
      shadow: 'none',
    })
  })

  it('미리 만든 모양 네 개를 각각 알아본다(꾸미기 밖 선언이 더 있어도)', () => {
    for (const p of BOX_PRESETS) {
      expect(parseBoxStyle(p.style).preset).toBe(p.key)
      expect(parseBoxStyle(`display: grid; ${p.style}; margin: 4px`).preset).toBe(p.key)
    }
  })

  it('공백·대소문자·쉼표 뒤 공백이 달라도 같은 모양으로 본다', () => {
    const squashed = preset('info').replace(/: /g, ':').replace(/; /g, ';').replace(/, /g, ',').toUpperCase().replace(/VAR/g, 'var')
    expect(parseBoxStyle(squashed).preset).toBe('info')
  })

  it('항목 하나만 달라도 미리 만든 모양이 아니다', () => {
    expect(parseBoxStyle(`${BOX_BASIC_STYLE}; box-shadow: 0 1px 2px black`).preset).toBeNull()
    expect(parseBoxStyle('').preset).toBeNull()
    expect(parseBoxStyle(null)).toMatchObject({ preset: null, border: 'none', radius: 'square', padding: null, shadow: 'none' })
  })

  it('테두리 굵기 — 없음·0·none·선 모양 없음은 없음, 2px 이상·thick·medium 은 굵게', () => {
    const b = (v: string) => parseBoxStyle(`border: ${v}`).border
    expect(b('none')).toBe('none')
    expect(b('0 solid red')).toBe('none')
    expect(b('1px red')).toBe('none')
    expect(b('1px solid red')).toBe('thin')
    expect(b('thin dashed red')).toBe('thin')
    expect(b('2px solid var(--x, #fff)')).toBe('thick')
    expect(b('thick solid')).toBe('thick')
    expect(b('solid')).toBe('thick')
  })

  it('테두리 가로 속성(border-width·border-style·border-color)도 읽는다 — 들여온 카드의 굵은 테두리가 「굵게」로 보이게', () => {
    expect(parseBoxStyle('border-width: 2px; border-style: solid').border).toBe('thick')
    expect(parseBoxStyle('border-width: 1px 0; border-style: dashed; border-color: red').border).toBe('thin')
    expect(parseBoxStyle('border-width: 2px').border).toBe('none')
    // 뒤에 오는 가로 속성이 shorthand 의 그 값만 덮고, 뒤에 오는 shorthand 는 앞 가로 속성을 모두 새로 정한다.
    expect(parseBoxStyle('border: 1px solid red; border-width: 3px').border).toBe('thick')
    expect(parseBoxStyle('border: 2px solid red; border-style: none').border).toBe('none')
    expect(parseBoxStyle('border-width: 3px; border: 1px solid').border).toBe('thin')
  })

  it('배경은 background·background-color 중 나중 값, 모서리 0 은 각지게, 여백은 세 단계 밖이면 null', () => {
    expect(parseBoxStyle('background-color: red; background: blue').background).toBe('blue')
    expect(parseBoxStyle('border-radius: 0').radius).toBe('square')
    expect(parseBoxStyle('border-radius: 4px').radius).toBe('round')
    expect(parseBoxStyle('padding: 8px  12px').padding).toBe('narrow')
    expect(parseBoxStyle('padding: 3px').padding).toBeNull()
    expect(parseBoxStyle('box-shadow: none').shadow).toBe('none')
  })
})

describe('applyBoxStyle — 항목 하나 바꾸기', () => {
  it('미리 만든 모양을 고르면 그 묶음 그대로가 되고, 꾸미기 밖 선언은 남는다', () => {
    expect(applyBoxStyle(BOX_BASIC_STYLE, { field: 'preset', value: 'warning' })).toBe(preset('warning'))
    const out = applyBoxStyle('display: grid; background: red; gap: 4px', { field: 'preset', value: 'strong' })
    expect(out).toBe(`display: grid; ${preset('strong')}; gap: 4px`)
    expect(parseBoxStyle(out).preset).toBe('strong')
  })

  it('모든 묶음 사이를 오가도 묶음 글자로 돌아온다(왕복)', () => {
    let style: string = BOX_BASIC_STYLE
    for (const p of [...BOX_PRESETS, ...BOX_PRESETS].reverse()) {
      style = applyBoxStyle(style, { field: 'preset', value: p.key })
      expect(style).toBe(p.style)
    }
  })

  it('배경·글자색 — 견본 값으로 바꾸고, 「없음」·「기본」은 선언을 지운다(자리와 다른 선언 순서는 그대로)', () => {
    const blue = BOX_BACKGROUNDS.find((s) => s.key === 'blue')!.value!
    const out = applyBoxStyle('margin: 0; background-color: red; padding: 8px 12px', { field: 'background', value: blue })
    expect(out).toBe(`margin: 0; background: ${blue}; padding: 8px 12px`)
    expect(normalizeValue(parseBoxStyle(out).background)).toBe(normalizeValue(blue))
    expect(applyBoxStyle(out, { field: 'background', value: null })).toBe('margin: 0; padding: 8px 12px')
    const brown = BOX_COLORS.find((s) => s.key === 'brown')!.value!
    const colored = applyBoxStyle(BOX_BASIC_STYLE, { field: 'color', value: brown })
    expect(colored).toBe(`${BOX_BASIC_STYLE}; color: ${brown}`)
    expect(applyBoxStyle(colored, { field: 'color', value: null })).toBe(BOX_BASIC_STYLE)
  })

  it('테두리 — 굵게는 색·선 모양을 살려 2px, 없음은 테두리 선언(가로 속성 포함)을 지운다, 없던 테두리는 기본 색 실선', () => {
    const thick = applyBoxStyle(preset('warning'), { field: 'border', value: 'thick' })
    expect(thick).toContain('border: 2px solid var(--wiki-box-warning-border, #f59e0b)')
    expect(parseBoxStyle(thick).border).toBe('thick')
    // 뒤의 border-color 가 shorthand 색을 이긴다(CSS 와 같다).
    expect(applyBoxStyle('border: 3px dashed red; border-color: blue', { field: 'border', value: 'thin' })).toBe('border: 1px dashed blue')
    // 가로 속성으로만 적힌 테두리도 선 모양·색을 살려 shorthand 하나로 바꾼다.
    expect(applyBoxStyle('border-width: 2px; border-style: dotted; border-color: green', { field: 'border', value: 'thin' })).toBe('border: 1px dotted green')
    expect(applyBoxStyle(`${BOX_BASIC_STYLE}; border-width: 4px`, { field: 'border', value: 'none' })).toBe('border-radius: 8px; padding: 12px 16px')
    expect(applyBoxStyle('padding: 1px', { field: 'border', value: 'thin' })).toBe('padding: 1px; border: 1px solid var(--border, #e5e7eb)')
  })

  it('모서리·여백·그림자', () => {
    expect(applyBoxStyle(BOX_BASIC_STYLE, { field: 'radius', value: 'square' })).toBe('border: 1px solid var(--border, #e5e7eb); padding: 12px 16px')
    expect(applyBoxStyle('padding: 1px', { field: 'radius', value: 'round' })).toBe('padding: 1px; border-radius: 8px')
    expect(parseBoxStyle(applyBoxStyle(BOX_BASIC_STYLE, { field: 'padding', value: 'wide' })).padding).toBe('wide')
    const shadow = applyBoxStyle(BOX_BASIC_STYLE, { field: 'shadow', value: 'has' })
    expect(parseBoxStyle(shadow)).toMatchObject({ shadow: 'has', preset: null })
    expect(applyBoxStyle(shadow, { field: 'shadow', value: 'none' })).toBe(BOX_BASIC_STYLE)
  })

  it('정리기는 거치지 않는다 — 저장하는 한곳(writeSelectedBoxStyle)이 정리하면 원래 style 의 위험 선언은 남지 않는다', () => {
    const out = applyBoxStyle('background: url(javascript:alert(1)); color: red', { field: 'radius', value: 'round' })
    expect(out).toBe('background: url(javascript:alert(1)); color: red; border-radius: 8px')
    expect(sanitizeInlineStyle(out)).toBe('color: red; border-radius: 8px')
  })

  it('묶음·견본 값은 정리기를 그대로 통과한다(var(--x, #hex) 포함)', () => {
    for (const p of BOX_PRESETS) expect(sanitizeInlineStyle(p.style)).toBe(p.style)
    for (const s of [...BOX_BACKGROUNDS, ...BOX_COLORS]) if (s.value) expect(sanitizeInlineStyle(`background: ${s.value}`)).toBe(`background: ${s.value}`)
  })
})

describe('저장·직접 고치기', () => {
  it('칸 글자는 선언 하나에 한 줄이고, 그대로 적용하면 같은 style 이다', () => {
    const text = styleToEditableText(preset('info'))
    expect(text.split('\n')).toHaveLength(5)
    expect(text.split('\n')[0]).toBe('background: var(--wiki-box-info-bg, #eff6ff);')
    expect(sanitizeInlineStyle(text)).toBe(preset('info'))
    expect(removedDeclCount(text)).toBe(0)
  })

  it('쓸 수 없는 값(url(javascript:)·expression(·behavior)은 정리기가 빼고, 뺀 수를 센다', () => {
    const text = ['color: red;', 'background: url(javascript:alert(1));', 'width: expression(alert(1));', 'behavior: url(x.htc);', 'padding: 4px'].join('\n')
    expect(sanitizeInlineStyle(text)).toBe('color: red; padding: 4px')
    expect(removedDeclCount(text)).toBe(3)
    expect(removedDeclCount('')).toBe(0)
    expect(removedNote(3)).toBe('쓸 수 없는 값 3개를 뺐습니다')
    expect(removedNote(0)).toBeNull()
  })

  it('data:image url 의 ; 로 선언이 쪼개지지 않는다', () => {
    const text = 'background: url(data:image/png;base64,AAAA); color: red'
    expect(sanitizeInlineStyle(text)).toBe(text)
    expect(removedDeclCount(text)).toBe(0)
  })

  it('페이지 CSS — 정리기가 @import·위험 값을 빼면 changed, 공백만 다르면 아니다', () => {
    expect(sanitizeEditedPageCss('.a {\n  color: red;\n}\n')).toEqual({ css: '.a {\n  color: red;\n}', changed: false })
    const r = sanitizeEditedPageCss('@import url(https://x.test/a.css);\n.a { background: url(javascript:alert(1)); color: red }')
    expect(r.changed).toBe(true)
    expect(r.css).not.toContain('javascript')
    expect(r.css).not.toContain('@import')
    expect(r.css).toContain('color: red')
  })

  it('styleToReact — 견본·모양 칸을 그릴 React style(속성 이름 낙타 표기)', () => {
    expect(styleToReact(preset('strong'))).toMatchObject({
      background: 'var(--wiki-box-strong-bg, #1e293b)',
      borderRadius: '8px',
      padding: '12px 16px',
    })
    expect(styleToReact('color: red; background: url(javascript:x)')).toEqual({ color: 'red' })
  })
})
