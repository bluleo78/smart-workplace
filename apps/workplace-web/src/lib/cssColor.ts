// CSS 색 글자 읽기·밝기 계산 — 메일 어둡게 보기(mailDarkMode)와 노트 밖 붙여넣기 거르기(wikiPasteForeign)가 함께 쓴다.
// 두 곳이 같은 표기(이름 색·#hex·rgb()·hsl())를 같은 규칙으로 읽도록 한 곳에 둔다(WP-1306 에서 mailDarkMode 에서 옮김).

/**
 * CSS 이름 색 148개(CSS Color 4) + 클래식 Outlook 의 시스템 색 `windowtext`·`window`. 일부만 두면 `bgcolor="lightyellow"` 같은
 * 밝은 이름 배경이 해석되지 않아 원본대로 남고 그 위 글자만 밝아진다 — 표 전체를 둬서 이름 색도 같은 규칙을 탄다.
 */
const NAMED: Record<string, [number, number, number]> = Object.fromEntries(
  (
  'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 ' +
  'black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 ' +
  'cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc ' +
  'crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 ' +
  'darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f ' +
  'darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f ' +
  'darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 ' +
  'deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 ' +
  'floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 ' +
  'goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 ' +
  'indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 ' +
  'lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff ' +
  'lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 ' +
  'lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 ' +
  'lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff ' +
  'maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db ' +
  'mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc ' +
  'mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 ' +
  'navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 ' +
  'orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 ' +
  'papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 ' +
  'rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 ' +
  'sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb ' +
  'slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 ' +
  'tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 ' +
  'white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32 ' +
    'windowtext:000000 window:ffffff'
  )
    .trim()
    .split(/\s+/)
    .map((entry) => {
      const [name, hex] = entry.split(':')
      return [name, [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]]
    }),
)

/** 색 하나 — 0~255 채널과 0~1 알파. */
export type Rgba = { r: number; g: number; b: number; a: number }

/**
 * CSS 색 문자열 → RGBA. 이름 색·#rgb(a)·#rrggbb(aa)·rgb()/rgba()·hsl()/hsla()(쉼표·공백·% 표기 모두)를 읽는다.
 * 해석하지 못한 밝은 배경은 원본대로 남는데 그 위 글자만 밝아지므로 메일에 쓰이는 표기는 넓게 받는다.
 * 그 외(oklch·currentcolor·var() 등)는 null(원본 유지).
 */
export function parseCssColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase()
  const named = NAMED[v]
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 }
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    const ch = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return { r: ch(0), g: ch(2), b: ch(4), a: h.length === 8 ? ch(6) / 255 : 1 }
  }
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(v)
  if (!fn) return null
  const parts = fn[2].trim().split(/\s*[,/]\s*|\s+/)
  if (parts.length < 3 || parts.length > 4) return null
  const num = (p: string, percentOf: number) => (p.endsWith('%') ? (parseFloat(p) / 100) * percentOf : parseFloat(p))
  const alpha = parts[3] === undefined ? 1 : num(parts[3], 1)
  let rgb: number[]
  if (fn[1].startsWith('rgb')) {
    rgb = parts.slice(0, 3).map((p) => Math.round(num(p, 255)))
  } else {
    const h = ((parseFloat(parts[0]) % 360) + 360) % 360
    rgb = hslToRgb(h / 360, num(parts[1], 1) / (parts[1].endsWith('%') ? 1 : 100), num(parts[2], 1) / (parts[2].endsWith('%') ? 1 : 100))
  }
  if ([...rgb, alpha].some((n) => Number.isNaN(n))) return null
  const [r, g, b] = rgb.map((n) => Math.min(255, Math.max(0, n)))
  return { r, g, b, a: Math.min(1, Math.max(0, alpha)) }
}

/** WCAG 상대 휘도(0 검정 ~ 1 흰색) — 사람 눈에 보이는 밝기로, 대비 판정의 기준 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** RGB(0~255) → HSL(각 0~1) */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h / 6, s, l]
}

/** HSL(각 0~1) → RGB(0~255 정수) */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)]
}
