// @vitest-environment jsdom
// 다크 테마 메일 본문 변환 테스트(WP-103, WP-159).
import { describe, expect, it } from 'vitest'

import { applyMailDarkMode, darkenLightBackground, lightenDarkColor, parseCssColor } from './mailDarkMode'

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

// WCAG 상대 휘도 — 변환 결과의 대비 확인용
const luminance = (v: string) => {
  const c = parseCssColor(v)!
  const lin = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

describe('parseCssColor', () => {
  it('rgb·hex·이름 색을 해석하고 모르는 값은 null', () => {
    expect(parseCssColor('rgb(0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(parseCssColor('rgba(10,20,30,0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
    expect(parseCssColor('#333')).toEqual({ r: 51, g: 51, b: 51, a: 1 })
    expect(parseCssColor('#1F497D')).toEqual({ r: 31, g: 73, b: 125, a: 1 })
    expect(parseCssColor('Black')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(parseCssColor('#ffffff80')).toEqual({ r: 255, g: 255, b: 255, a: 128 / 255 })
    expect(parseCssColor('rgb(100%, 50%, 0%)')).toEqual({ r: 255, g: 128, b: 0, a: 1 })
    expect(parseCssColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
    expect(parseCssColor('hsl(0, 0%, 98%)')).toEqual({ r: 250, g: 250, b: 250, a: 1 })
    expect(parseCssColor('hsl(60deg 100% 50%)')).toEqual({ r: 255, g: 255, b: 0, a: 1 })
    expect(parseCssColor('currentcolor')).toBeNull()
    expect(parseCssColor('oklch(0.5 0.1 200)')).toBeNull()
    expect(parseCssColor('rgb(var(--x))')).toBeNull()
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

  // 다크 배경(휘도 ≈0.005) 대비 4.5:1 ⇔ 휘도 0.2 이상
  it.each(['blue', '#0000FF', 'purple', '#0563C1', 'indigo', 'midnightblue', 'darkred', 'rgb(119, 119, 119)'])(
    '명도는 중간이어도 휘도가 낮은 %s 는 다크 배경에서 읽히도록(휘도 ≥ 0.2) 밝힌다',
    (v) => {
      const next = lightenDarkColor(v)
      expect(next).not.toBeNull()
      expect(luminance(next!)).toBeGreaterThanOrEqual(0.2)
    },
  )

  it('색상(hue)을 유지한다 — 남색은 밝은 파랑 계열', () => {
    const c = parseCssColor(lightenDarkColor('navy')!)!
    expect(c.b).toBeGreaterThan(c.r)
    expect(c.b).toBeGreaterThan(c.g)
  })
})

describe('darkenLightBackground', () => {
  it('흰색·거의 흰색은 투명으로 — 앱 배경이 비치게', () => {
    for (const v of ['white', 'window', '#fff', 'rgb(255, 255, 255)', '#f5f5f5', 'snow']) expect(darkenLightBackground(v)).toBe('transparent')
  })

  it.each(['rgb(255, 255, 0)', '#ffeeaa', '#eee', '#ffffe0', '#336699', 'rgb(255, 102, 0)'])(
    '밝은·중간 배경 %s 는 휘도 0.03 이하로 어둡게 — 밝힌 글자(휘도 ≥ 0.2)와 대비 3:1 이상',
    (v) => {
      const next = darkenLightBackground(v)!
      expect(luminance(next)).toBeLessThanOrEqual(0.03)
      expect((0.2 + 0.05) / (luminance(next) + 0.05)).toBeGreaterThanOrEqual(3)
    },
  )

  it('색상(hue)을 유지한다 — 노란 형광펜은 짙은 노랑(올리브), 앱 배경과 구분되게', () => {
    const c = parseCssColor(darkenLightBackground('rgb(255, 255, 0)')!)!
    expect(c.r).toBe(c.g)
    expect(c.b).toBeLessThan(c.r)
    expect(c.r).toBeGreaterThan(30)
  })

  it('이미 어두운 배경·투명·키워드·해석 불가 값은 유지(null)', () => {
    for (const v of ['#000', 'rgb(20, 20, 40)', 'transparent', 'rgba(255,255,255,0)', 'none', 'url(a.png)', 'oklch(0.9 0 0)']) {
      expect(darkenLightBackground(v)).toBeNull()
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
    // 레거시 색 속성은 인라인 style 로 옮겨 같은 규칙을 탄다(# 없는 hex 도 해석), 해석 못 하는 값은 속성 그대로
    const doc = parse(applyMailDarkMode('<p><font id="f" color="000000">x</font><font id="g" color="junk">y</font></p>', colors))
    expect(doc.getElementById('f')!.hasAttribute('color')).toBe(false)
    expect(doc.getElementById('f')!.style.color).toBe('rgb(237, 237, 237)')
    expect(doc.getElementById('g')!.getAttribute('color')).toBe('junk')
  })

  // WP-159 실제 메일(Gmail 작성)을 줄인 것 — 소제목 형광펜 하나 때문에 메일 전체가 원본(흰 바탕)으로 남던 문제
  it('형광펜이 있는 메일도 다크로 — 형광펜은 짙은 노랑으로 남고 글자는 밝은 기본색', () => {
    const html =
      '<html><head></head><body><div dir="ltr"><p>안녕하세요.</p>' +
      '<strong id="t" style="background-color:transparent">10월 생태계분과 회의</strong>' +
      '<h3><font id="hl" size="2" style="background-color:rgb(255,255,0)">■ 일정/장소</font></h3></div></body></html>'
    const doc = parse(applyMailDarkMode(html, colors))
    expect(doc.head.querySelector('style')!.textContent).toContain(`background:${colors.background}`)
    expect(doc.getElementById('t')!.style.backgroundColor).toBe('transparent')
    const hl = doc.getElementById('hl')!.style.backgroundColor
    expect(hl).not.toBe('rgb(255, 255, 0)')
    expect(luminance(hl)).toBeLessThanOrEqual(0.03)
  })

  it('표 기반 뉴스레터 — bgcolor 를 인라인 배경으로 옮겨 어둡게(흰색은 투명), 어두운 배경은 유지', () => {
    const html =
      '<body bgcolor="#336699"><table id="outer" bgcolor="f4f4f4"><tr><td id="card" bgcolor="#FFFFCC" style="color:#000000">x</td>' +
      '<td id="dark" bgcolor="#111111" style="color:#ffffff">y</td></tr></table></body>'
    const doc = parse(applyMailDarkMode(html, colors))
    expect(doc.querySelector('[bgcolor]')).toBeNull()
    expect(doc.getElementById('outer')!.style.backgroundColor).toBe('transparent')
    expect(luminance(doc.getElementById('card')!.style.backgroundColor)).toBeLessThanOrEqual(0.03)
    expect(doc.getElementById('card')!.style.color).toBe('rgb(237, 237, 237)')
    expect(doc.getElementById('dark')!.style.backgroundColor).toBe('rgb(17, 17, 17)')
    expect(doc.getElementById('dark')!.style.color).toBe('rgb(255, 255, 255)')
    // body 의 유색 배경도 인라인이라 기본 규칙(html,body{background})보다 우선
    expect(luminance(doc.body.style.backgroundColor)).toBeLessThanOrEqual(0.03)
  })

  it('이름으로 쓴 밝은 배경(lightyellow·beige 등)도 어둡게 — 그 위 밝힌 글자가 읽히게', () => {
    const html = '<table bgcolor="lightyellow"><tr><td id="c" style="background-color:beige; color:#000">x</td></tr></table>'
    const doc = parse(applyMailDarkMode(html, colors))
    expect(luminance(doc.querySelector('table')!.style.backgroundColor)).toBeLessThanOrEqual(0.03)
    expect(luminance(doc.getElementById('c')!.style.backgroundColor)).toBeLessThanOrEqual(0.03)
    for (const v of ['yellow', 'lightblue', 'silver', 'lightgrey']) expect(luminance(darkenLightBackground(v)!)).toBeLessThanOrEqual(0.03)
  })

  it('레거시 background 속성(셀 배경 그림)은 인라인 배경 이미지로 옮기고 덮개(inset box-shadow)로 어둡게', () => {
    const doc = parse(applyMailDarkMode('<table><tr><td id="c" background="hero.jpg">x</td></tr></table>', colors))
    const el = doc.getElementById('c')!
    expect(el.hasAttribute('background')).toBe(false)
    expect(el.style.backgroundImage).toContain('hero.jpg')
    expect(el.style.boxShadow).toContain('inset')
  })

  it('브라우저가 반영하지 않는 요소의 bgcolor·background 속성은 옮기지 않는다(원래 안 보이던 배경을 만들지 않게)', () => {
    const doc = parse(applyMailDarkMode('<div id="d" background="track.png" bgcolor="#ffeeaa">x</div>', colors))
    const el = doc.getElementById('d')!
    expect(el.getAttribute('style')).toBeNull()
    expect(el.getAttribute('bgcolor')).toBe('#ffeeaa')
  })

  it('군더더기가 붙은 bgcolor(`#F2F2F2;`)도 앞쪽 hex 로 읽는다', () => {
    const doc = parse(applyMailDarkMode('<table id="t" bgcolor="#FFFFCC;"><tr><td>x</td></tr></table>', colors))
    expect(luminance(doc.getElementById('t')!.style.backgroundColor)).toBeLessThanOrEqual(0.03)
  })

  it('<style> 의 유색 배경은 어둡게, url(...) 안의 이름은 색으로 읽지 않는다', () => {
    const html =
      '<style>body{background:#ffeeaa} td{background:#fff url(white.png)} .x{background-image:url(a.png) !important}' +
      ' .card{background:hsl(0,0%,98%);color:#333}</style><p>x</p>'
    const css = [...parse(applyMailDarkMode(html, colors)).querySelectorAll('style')].map((st) => st.textContent).join('\n')
    expect(css).not.toContain('#ffeeaa')
    // 이미지가 있는 배경 선언 앞에 덮개를 끼운다 — 배경 레이어 목록은 그대로, !important 도 원래 선언에 남는다
    const shade = 'box-shadow:inset 0 0 0 9999px rgba(0, 0, 0, 0.7);'
    expect(css).toContain(`td{${shade}background:transparent url(white.png)}`)
    expect(css).toContain(`.x{${shade}background-image:url(a.png) !important}`)
    // hsl() 로 쓴 거의 흰 카드도 투명으로
    expect(css).toContain('.card{background:transparent;')
  })

  it('원본 doctype 을 보존한다(표준/쿼크 모드 유지)', () => {
    const out = applyMailDarkMode('<!DOCTYPE html><html><body><p>x</p></body></html>', colors)
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(applyMailDarkMode('<p>x</p>', colors).startsWith('<html')).toBe(true)
  })
})
