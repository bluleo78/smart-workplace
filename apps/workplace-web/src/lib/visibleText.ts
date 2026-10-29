/**
 * 보이는 글자 판정·다듬기 (WP-1107·WP-1106).
 *
 * 공백·제로폭 문자·결합 부호·한글 채움(\u3164)·점자 빈칸처럼 화면에 아무것도 그려지지 않는 글자만 있으면 비어 있는 것으로 본다.
 * 서버 `PersonNames.hasVisibleChar`·`SingleLineTitles` 와 같은 범위라, 화면에서 통과한 값이 서버에서 「…을 입력해 주세요」로 막히지 않는다.
 */

/** 공백류·서식 문자 밖의 보이지 않는 글자 — 한글 채움 문자 4종·점자 빈칸. 아래 정규식들이 함께 쓴다. */
const FILLERS = '\\u115F\\u1160\\u3164\\uFFA0\\u2800'
/** 그려지는 글자 하나 — 보이지 않는 글자·제어 문자·홀로 그려지지 않는 결합 문자(\p{Mn}·\p{Me})가 아닌 글자. */
const VISIBLE = new RegExp(`[^\\s\\p{Z}\\p{Cf}\\p{Cc}\\p{Mn}\\p{Me}${FILLERS}]`, 'u')
/** 보이지 않는 글자 — 공백류·서식 문자(\p{Cf}: 제로폭 공백·결합자·BOM 등)·위 채움 문자. */
const INVISIBLE = `[\\s\\p{Z}\\p{Cf}${FILLERS}]`
const INVISIBLE_EDGES = new RegExp(`^${INVISIBLE}+|${INVISIBLE}+$`, 'gu')

/** 화면에 보이는 글자가 하나라도 있는가. */
export function hasVisibleText(text: string): boolean {
  return VISIBLE.test(text)
}

/**
 * NFC 로 맞추고(서버와 같은 글자 수) 앞뒤의 보이지 않는 글자를 지운 값 — 그려지는 글자가 하나도 없으면 빈 문자열(WP-1106).
 * 입력 칸 검사에서 이 값이 비면 「…을 입력해 주세요」로 막는다 — `trim()` 은 제로폭 공백·점자 빈칸을 남겨 이름 없는 행이 저장됐다.
 */
export function trimInvisible(value: string): string {
  return stripInvisibleEdges(value.normalize('NFC'))
}

/** NFC 로 맞춘 값에서 앞뒤의 보이지 않는 글자를 지운다 — 그려지는 글자가 없으면 빈 문자열. */
function stripInvisibleEdges(nfc: string): string {
  const trimmed = nfc.replace(INVISIBLE_EDGES, '')
  return hasVisibleText(trimmed) ? trimmed : ''
}

/** 줄을 바꾸는 문자 — 제어 문자(줄바꿈·탭 등 C0·C1)와 줄/문단 구분자. 서버 `SingleLineTitles.LINE_BREAKS` 와 같다. */
const LINE_BREAKS = /[\p{Cc}\u2028\u2029]+/gu
/** 양방향 제어 문자 — 뒤 글자의 표시 순서를 뒤집어 제목을 속일 수 있어 지운다. 서버 `SingleLineTitles.BIDI_CONTROLS` 와 같다. */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/gu

/**
 * 한 줄 제목으로 다듬은 값 — 서버 `SingleLineTitles.normalize` 와 같은 순서(NFC → 양방향 제어 지움 → 줄바꿈·탭을 공백 하나로 → 앞뒤 보이지 않는 글자 지움)라
 * 화면이 재는 글자 수·보내는 값이 서버가 저장할 값과 같다(WP-1171). 그려지는 글자가 없으면 빈 문자열.
 */
export function normalizeSingleLine(value: string): string {
  const oneLine = value.normalize('NFC').replace(BIDI_CONTROLS, '').replace(LINE_BREAKS, ' ')
  return stripInvisibleEdges(oneLine)
}
