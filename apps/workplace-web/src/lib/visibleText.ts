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
  const trimmed = value.normalize('NFC').replace(INVISIBLE_EDGES, '')
  return hasVisibleText(trimmed) ? trimmed : ''
}
