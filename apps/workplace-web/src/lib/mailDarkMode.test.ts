// @vitest-environment jsdom
// 다크 테마 메일 본문 변환 테스트(WP-103).
import { describe, expect, it } from 'vitest'

import { applyMailDarkMode, hasOwnBackground, isNeutralBackground, lightenDarkColor, parseCssColor } from './mailDarkMode'

const colors = { background: 'oklch(0.13 0.015 280)', foreground: 'oklch(0.93 0 0)', link: 'oklch(0.65 0.2 264)' }

// 실제 Outlook(OWA) 사내 메일을 줄인 것 — 모든 요소에 color:rgb(0,0,0), 서명에 회색·오렌지 강조색
const OUTLOOK = `<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style type="text/css" style="display:none">
<!--
p
	{margin-top:0;
	margin-bottom:0}
-->
</style></head><body dir="ltr"><div id="t" style="font-family:Aptos,Calibri,sans-serif; font-size:12pt; color:rgb(0,0,0)">안녕하세요.</div>
<table style="width:450px; color:rgb(0,0,0); border-collapse:collapse"><tr><td>
<span id="gray" style="font-size:10pt; color:rgb(51,51,51)">전략사업부 | 과장</span>
<span id="orange" style="color:rgb(243,112,33)"><b>M. </b></span>
<div id="rule" style="border-bottom:1px solid rgb(243,112,33)"></div>
</td></tr></table></body></html>`

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')

describe('parseCssColor', () => {
  it('rgb·hex·이름 색을 해석하고 모르는 값은 null', () => {
    expect(parseCssColor('rgb(0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(parseCssColor('rgba(10,20,30,0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
    expect(parseCssColor('#333')).toEqual({ r: 51, g: 51, b: 51, a: 1 })
    expect(parseCssColor('#1F497D')).toEqual({ r: 31, g: 73, b: 125, a: 1 })
    expect(parseCssColor('Black')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(parseCssColor('currentcolor')).toBeNull()
    expect(parseCssColor('oklch(0.5 0.1 200)')).toBeNull()
  })
})

describe('lightenDarkColor', () => {
  it('검정은 밝은 회백으로, 어두운 회색은 밝은 회색으로 뒤집는다', () => {
    expect(lightenDarkColor('rgb(0, 0, 0)')).toBe('rgb(237, 237, 237)')
    const gray = parseCssColor(lightenDarkColor('rgb(51, 51, 51)')!)!
    expect(gray.r).toBeGreaterThan(180)
  })

  it('밝은 강조색·흰색은 유지(null)', () => {
    expect(lightenDarkColor('rgb(243, 112, 33)')).toBeNull()
    expect(lightenDarkColor('#fff')).toBeNull()
  })

  it('색상(hue)을 유지한다 — 남색은 밝은 파랑 계열', () => {
    const c = parseCssColor(lightenDarkColor('navy')!)!
    expect(c.b).toBeGreaterThan(c.r)
    expect(c.b).toBeGreaterThan(c.g)
  })
})

describe('hasOwnBackground', () => {
  it('margin 만 있는 <style> 과 인라인 글자색만 있는 Outlook 메일은 배경 없음', () => {
    expect(hasOwnBackground(parse(OUTLOOK))).toBe(false)
  })

  it('클래스 이름에 Background 가 들어간 것만으로는 배경으로 보지 않는다(SharePoint 알림)', () => {
    const html = '<style>.headerBackgroundMsoTable{border-spacing:0; width:100%}</style><table class="headerBackgroundMsoTable"><tr><td>x</td></tr></table>'
    expect(hasOwnBackground(parse(html))).toBe(false)
  })

  it.each([
    ['bgcolor 속성(흰색이어도)', '<table bgcolor="#ffffff"><tr><td>x</td></tr></table>'],
    ['background 속성', '<table><tr><td background="bg.png">x</td></tr></table>'],
    ['인라인 유색 배경', '<div style="background-color:#ffeeaa">x</div>'],
    ['인라인 형광펜(노랑)', '<span style="background-color:rgb(255,255,0)">x</span>'],
    ['인라인 배경 이미지', '<div style="background-image:url(a.png)">x</div>'],
    ['<style> 유색 배경', '<style>body{background:#336699}</style><p>x</p>'],
    ['<style> 배경 이미지', '<style>td{background:#fff url(a.png)}</style><p>x</p>'],
    ['<style> background-image', '<style>td{background-image:url(a.png)}</style><p>x</p>'],
  ])('%s → 배경 있음', (_, html) => {
    expect(hasOwnBackground(parse(html))).toBe(true)
  })

  it.each([
    ['인라인 흰 배경(붙여넣기)', '<div style="background-color:white; color:rgb(0,0,0)">x</div>'],
    ['인라인 background 단축 #fff', '<p style="background:#fff">x</p>'],
    ['인라인 거의 흰색', '<p style="background-color:#f5f5f5">x</p>'],
    ['인라인 투명', '<p style="background-color:transparent">x</p>'],
    ['<style> 흰 배경', '<style>#signDiv{background-color:#ffffff}</style><div id="signDiv">x</div>'],
    ['<style> 글자색만(클래식 Outlook)', '<style>a:link{color:#0563C1} span.EmailStyle22{color:windowtext}</style><p>x</p>'],
  ])('%s → 중립(변환 대상)', (_, html) => {
    expect(hasOwnBackground(parse(html))).toBe(false)
  })
})

describe('isNeutralBackground', () => {
  it('흰색·거의 흰색·투명·키워드는 중립, 유색은 아님', () => {
    for (const v of ['white', '#FFF', 'rgb(255, 255, 255)', '#f5f5f5', 'rgba(0,0,0,0)', 'transparent', 'initial', '']) {
      expect(isNeutralBackground(v)).toBe(true)
    }
    for (const v of ['#eee', 'rgb(255,255,0)', '#336699', 'lightyellow']) {
      expect(isNeutralBackground(v)).toBe(false)
    }
  })
})

describe('applyMailDarkMode', () => {
  it('인라인 흰 배경은 투명으로 바꿔 다크 바탕 위 흰 조각을 없앤다', () => {
    const doc = parse(applyMailDarkMode('<div id="p" style="background-color:white; color:rgb(0,0,0)">x</div>', colors))
    const el = doc.getElementById('p')!
    expect(el.style.backgroundColor).toBe('transparent')
    expect(el.style.color).toBe('rgb(237, 237, 237)')
  })

  it('클래식 Outlook <style> — 링크·windowtext 글자색을 밝게, 흰 배경은 투명으로, !important 유지', () => {
    const html =
      '<html><head><style>a:link, span.MsoHyperlink{mso-style-priority:99; color:#0563C1; text-decoration:underline}' +
      ' span.EmailStyle22{color:windowtext !important} #signDiv{background-color:#ffffff}' +
      ' td{border-color:#000}</style></head><body><p>x</p></body></html>'
    const out = parse(applyMailDarkMode(html, colors))
    const css = [...out.querySelectorAll('style')].map((st) => st.textContent).join('\n')
    expect(css).not.toContain('#0563C1')
    expect(css).toContain('span.EmailStyle22{color:rgb(237, 237, 237)!important}')
    expect(css).toContain('#signDiv{background-color:transparent}')
    // 테두리색은 글자색 규칙이 아니므로 그대로
    expect(css).toContain('border-color:#000')
    const link = parseCssColor(/MsoHyperlink\{[^}]*color:(rgb\([^)]+\))/.exec(css)![1])!
    expect(link.b).toBeGreaterThan(link.r)
  })

  it('Outlook 메일 — 테마 배경 주입, 어두운 글자만 밝게, 강조색·테두리는 유지', () => {
    const doc = parse(applyMailDarkMode(OUTLOOK, colors))
    const base = doc.head.querySelector('style')!.textContent!
    expect(base).toContain(`background:${colors.background}`)
    expect(base).toContain(`color:${colors.foreground}`)
    expect(base).toContain(`a{color:${colors.link}}`)
    expect(doc.getElementById('t')!.style.color).toBe('rgb(237, 237, 237)')
    expect(doc.getElementById('t')!.style.fontSize).toBe('12pt')
    expect(doc.getElementById('orange')!.style.color).toBe('rgb(243, 112, 33)')
    expect(doc.getElementById('rule')!.getAttribute('style')).toBe('border-bottom:1px solid rgb(243,112,33)')
  })

  it('<font color> 도 보정한다', () => {
    const doc = parse(applyMailDarkMode('<p><font id="f" color="#000000">x</font></p>', colors))
    expect(doc.getElementById('f')!.getAttribute('color')).toBe('rgb(237, 237, 237)')
  })

  it('배경을 지정한 메일은 입력 문자열 그대로', () => {
    const html = '<table bgcolor="#fff"><tr><td style="color:#000">x</td></tr></table>'
    expect(applyMailDarkMode(html, colors)).toBe(html)
  })

  it('원본 doctype 을 보존한다(표준/쿼크 모드 유지)', () => {
    const out = applyMailDarkMode('<!DOCTYPE html><html><body><p>x</p></body></html>', colors)
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(applyMailDarkMode('<p>x</p>', colors).startsWith('<html')).toBe(true)
  })
})
