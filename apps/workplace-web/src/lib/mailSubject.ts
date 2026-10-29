// 메일 제목 표시(WP-1110) — 비었거나 보이지 않는 글자(공백·제로폭 공백 등)뿐인 제목은 「(제목 없음)」으로 보인다.
// 그대로 그리면 받은편지함·상세·임시보관함에 빈 제목 줄이 생기고 행 이름(aria-label)도 비었다.

/** 화면에 아무것도 그리지 않는 글자 — 공백류(\s, U+FEFF 포함)와 제로폭 공백·연결자(U+200B~U+200D)·단어 연결자(U+2060)·소프트 하이픈. */
const INVISIBLE = /[\s\u200B-\u200D\u2060\u00AD]/g

export const NO_MAIL_SUBJECT = '(제목 없음)'

/** 보이는 글자가 하나라도 있는 제목인가 — 흐린 글자색(빈 제목) 판정에도 쓴다. */
export function hasMailSubject(subject: string | null | undefined): subject is string {
  return subject != null && subject.replace(INVISIBLE, '') !== ''
}

/** 화면에 보일 제목 — 보이는 글자가 없으면 「(제목 없음)」. 있는 제목은 고치지 않고 그대로 둔다. */
export function mailSubjectText(subject: string | null | undefined): string {
  return hasMailSubject(subject) ? subject : NO_MAIL_SUBJECT
}
