// 메일 상세 수신자 표시(WP-400) — 저장된 받는사람·참조 문자열을 사람 단위로 나누고, 모바일 상세의 한 줄 요약을 만든다.

/** 수신자 한 명 — 표시 이름이 없으면 name 은 null. */
export interface MailRecipient {
  name: string | null
  address: string
}

/**
 * 주소 목록 글자에서 사람 사이 구분자(쉼표·세미콜론) 위치들. 따옴표·꺾쇠 안의 구분자는 건너뛴다 — 이름에 쉼표가 든 수신자가 둘로 갈라지지
 * 않게. 끝까지 닫히지 않은 따옴표·꺾쇠(`Kim <kim@x.com, lee@y.com` 처럼 > 를 빠뜨림)는 감싼 것으로 보지 않는다 — 그 뒤 구분자를 놓치면
 * 여러 주소가 한 수신인으로 묶여 잘못 보내진다(WP-945).
 */
export function addressSeparatorIndexes(raw: string, honorQuote = true, honorAngle = true): number[] {
  const out: number[] = []
  let inQuote = false
  let inAngle = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch === '"' && honorQuote) inQuote = !inQuote
    else if (ch === '<' && honorAngle && !inQuote) inAngle = true
    else if (ch === '>' && honorAngle && !inQuote) inAngle = false
    else if ((ch === ',' || ch === ';') && !inQuote && !inAngle) out.push(i)
  }
  if (inQuote) return addressSeparatorIndexes(raw, false, honorAngle)
  if (inAngle) return addressSeparatorIndexes(raw, honorQuote, false)
  return out
}

/** 사람 한 명 표기(`이름 <주소>`·`"성, 이름" <주소>`·주소) → 수신자. 빈 글자면 null. */
function parseOne(token: string): MailRecipient | null {
  const t = token.trim()
  if (!t) return null
  const m = t.match(/^(.*?)\s*<([^>]+)>\s*$/)
  if (!m) return { name: null, address: t }
  const name = m[1].trim().replace(/^"(.*)"$/, '$1').trim()
  return { name: name || null, address: m[2].trim() }
}

/** `이름 <a@b>, "성, 이름" <c@d>, e@f` 형태의 주소 목록을 사람 단위로 나눈다(구분 규칙은 addressSeparatorIndexes). */
export function parseAddressList(raw: string | null | undefined): MailRecipient[] {
  if (!raw) return []
  const out: MailRecipient[] = []
  let start = 0
  for (const cut of [...addressSeparatorIndexes(raw), raw.length]) {
    const r = parseOne(raw.slice(start, cut))
    if (r) out.push(r)
    start = cut + 1
  }
  return out
}

/** 요약에 쓰는 짧은 이름 — 표시 이름, 없으면 주소의 @ 앞(로컬파트). */
export function recipientShortName(r: MailRecipient): string {
  return r.name ?? r.address.split('@')[0]
}

/** 목록에 쓰는 전체 표기 — `이름 <주소>` 또는 주소만. */
export function recipientFullLabel(r: MailRecipient): string {
  return r.name ? `${r.name} <${r.address}>` : r.address
}

/**
 * 작성창·발송에 쓰는 주소 표기 — 표시 이름에 구분자(쉼표·세미콜론)·따옴표·꺾쇠가 있으면 따옴표로 감싼다(`"김, 철수" <kim@x>`).
 * 그래야 작성창 입력으로 다시 나눠도(parseAddressList) 한 사람으로 남는다. 이름 안의 따옴표는 뺀다(나누기가 이스케이프를 모른다).
 */
export function recipientAddressLabel(r: MailRecipient): string {
  if (!r.name) return r.address
  const name = /[,;<>"]/.test(r.name) ? `"${r.name.replace(/"/g, '')}"` : r.name
  return `${name} <${r.address}>`
}

/**
 * 작성창 받는사람·참조·숨은참조 입력 → 발송 주소 목록. 쉼표·세미콜론으로 나누되 따옴표·꺾쇠 안의 구분자는 지킨다
 * — 전체답장으로 채운 `"김, 철수" <kim@x>` 가 둘로 갈라져 잘못된 주소로 보내지지 않게.
 */
export function parseRecipientInput(raw: string): string[] {
  return parseAddressList(raw).map(recipientAddressLabel)
}

/**
 * 모바일 상세의 수신자 한 줄 요약 — 「받는사람 홍길동 외 2명 · 참조 7명 · 숨은참조 1명」.
 * 받는사람은 첫 사람 이름을 보여 주고, 참조·숨은참조는 인원수만 센다. 아무도 없으면 빈 문자열.
 */
export function summarizeRecipients(to: MailRecipient[], cc: MailRecipient[], bcc: MailRecipient[]): string {
  const parts: string[] = []
  if (to.length > 0) {
    const first = recipientShortName(to[0])
    parts.push(to.length === 1 ? `받는사람 ${first}` : `받는사람 ${first} 외 ${to.length - 1}명`)
  }
  if (cc.length > 0) parts.push(`참조 ${cc.length}명`)
  if (bcc.length > 0) parts.push(`숨은참조 ${bcc.length}명`)
  return parts.join(' · ')
}

/**
 * 전체답장 참조 목록 — 원본의 받는사람·참조에서 나(exclude)와 보낸 사람을 빼고, 같은 주소는 한 번만 남긴다(대소문자 무시).
 * 표기는 작성창 입력과 같은 규칙(recipientAddressLabel)이라 이름에 쉼표가 있어도 한 사람으로 남는다.
 */
export function replyAllCc(toRaw: string | null, ccRaw: string | null, ...exclude: (string | null | undefined)[]): string[] {
  const seen = new Set(exclude.filter((a): a is string => !!a).map((a) => a.toLowerCase()))
  const out: string[] = []
  for (const r of [...parseAddressList(toRaw), ...parseAddressList(ccRaw)]) {
    const key = r.address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(recipientAddressLabel(r))
  }
  return out
}
