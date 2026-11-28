// 메일 받는사람 자동완성(WP-945) — 칩 입력의 글자 나누기와, 최근 수신인·구성원·주소록 후보 합치기.
import { addressSeparatorIndexes, type MailRecipient, parseAddressList, recipientAddressLabel } from './mailRecipients'

/** 후보 출처 — 최근 수신인(보낸 메일) · 구성원(조직) · 주소록(외부 연락처). */
export type RecipientSource = 'recent' | 'member' | 'external'

/** 자동완성 후보 한 명. */
export interface RecipientSuggestion {
  address: string
  name: string | null
  source: RecipientSource
}

/** 출처 표시 — 후보 줄 오른쪽 작은 꼬리표. */
export const RECIPIENT_SOURCE_LABEL: Record<RecipientSource, string> = {
  recent: '최근',
  member: '구성원',
  external: '주소록',
}

/**
 * 입력 칸 글자 → 칩으로 굳힐 주소들 + 칸에 남길 조각. 구분자(쉼표·세미콜론) 앞까지는 칩이 되고, 마지막 구분자 뒤는 아직 쓰는 중이라 남긴다.
 * 쉼표를 치거나 여러 주소를 붙여 넣는 경우를 한 규칙으로 다룬다.
 */
export function splitTypedRecipients(raw: string): { committed: RecipientChip[]; rest: string } {
  const cut = addressSeparatorIndexes(raw).at(-1)
  if (cut === undefined) return { committed: [], rest: raw }
  return { committed: toChips(raw.slice(0, cut)), rest: raw.slice(cut + 1).trimStart() }
}

/** 작성창 상태로 넘기는 한 줄 — 칩 뒤에 쓰는 중인 조각을 붙인다(저장·발송은 이 한 줄을 parseRecipientInput 으로 다시 나눈다). */
export function joinRecipients(chips: RecipientChip[], rest: string): string {
  return [...chips.map((c) => c.label), rest.trim()].filter(Boolean).join(', ')
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/

/** 넣은 수신인 칩 — 만들 때 한 번만 나눠 둔다(그릴 때마다 다시 나누지 않게). */
export interface RecipientChip {
  /** 저장·발송에 쓰는 표기(`이름 <주소>` 또는 주소) */
  label: string
  /** 칩에 보이는 짧은 이름 — 표시 이름, 없으면 주소 */
  text: string
  /** 소문자 주소 — 이미 넣은 사람을 후보에서 빼는 데 쓴다 */
  key: string
  /** 메일 주소 모양인지 — 아니면 오류 칩으로 보인다 */
  ok: boolean
}

/** 수신자 하나 → 칩. */
export function toChip(r: MailRecipient): RecipientChip {
  return {
    label: recipientAddressLabel(r),
    text: r.name ?? r.address,
    key: r.address.trim().toLowerCase(),
    ok: EMAIL_RE.test(r.address),
  }
}

/** 표기 글자(쉼표로 이은 여러 명 가능) → 칩들. */
export function toChips(raw: string): RecipientChip[] {
  return parseAddressList(raw).map(toChip)
}

/** 쓴 글자 한 조각이 완성된 메일 주소인지 — Enter 가 후보 대신 쓴 주소를 넣을지 정한다. */
export function isCompleteAddress(text: string): boolean {
  const [r] = parseAddressList(text)
  return !!r && EMAIL_RE.test(r.address)
}

/** 후보가 쓰는 조각(소문자)에 맞는 정도 — 주소·이름이 조각으로 시작하면 0, 어딘가 들어 있으면 1, 없으면 -1. */
function rank(s: RecipientSuggestion, q: string): number {
  const fields = [s.address.toLowerCase(), s.name?.toLowerCase() ?? '']
  if (fields.some((f) => f.startsWith(q))) return 0
  return fields.some((f) => f.includes(q)) ? 1 : -1
}

/**
 * 후보 합치기 — 최근 수신인 → 구성원 → 주소록 순으로 늘어놓고 같은 주소는 앞선 것만 남긴 뒤, 주소·이름이 검색어로 **시작하는** 후보를 앞으로
 * 올린다(그 안의 순서는 그대로 — 안정 정렬). 검색어가 주소·이름 어디에도 없는 후보(한 번 받아 둔 최근 수신인·앞선 검색의 연락처), 이미 넣은
 * 주소(exclude, 소문자), 주소가 없는 연락처는 뺀다. 최근 수신인에 이름이 없으면 같은 주소의 구성원·주소록 이름으로 채운다.
 */
export function mergeRecipientSuggestions(
  query: string,
  lists: { recent: RecipientSuggestion[]; member: RecipientSuggestion[]; external: RecipientSuggestion[] },
  exclude: ReadonlySet<string>,
  limit: number,
): RecipientSuggestion[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const byAddress = new Map<string, RecipientSuggestion>()
  for (const s of [...lists.recent, ...lists.member, ...lists.external]) {
    const key = s.address.trim().toLowerCase()
    if (!key || exclude.has(key)) continue
    const seen = byAddress.get(key)
    if (!seen) byAddress.set(key, { ...s, address: s.address.trim() })
    else if (!seen.name && s.name) seen.name = s.name
  }
  return [...byAddress.values()]
    .map((s) => ({ s, r: rank(s, q) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r)
    .slice(0, limit)
    .map(({ s }) => s)
}

/** 수신인 칸 — 받는사람·참조·숨은참조 중 하나. */
export type RecipientField = 'to' | 'cc' | 'bcc'

/** 칸 이름 — 화면 라벨과 「옮기기」 문구가 칩 메뉴와 끌어놓기 강조 표시에서 같은 글자를 쓰게 한 곳에서 정한다(WP-2150). */
export const RECIPIENT_FIELD_LABEL: Record<RecipientField, string> = {
  to: '받는사람',
  cc: '참조',
  bcc: '숨은참조',
}

/**
 * 「참조로 옮기기」 같은 칸 이동 문구 — 받는사람은 받침(ㅁ)에 따라 「받는사람으로」, 참조·숨은참조는 「참조로」·「숨은참조로」
 * (한국어 조사: 받침 없으면 로, 받침 있으면 으로). 칸 이름 셋이 정해져 있어 필드로 갈린다 — 메뉴 항목과 드롭 강조가 같은 문구를 쓴다.
 */
export function recipientFieldMoveLabel(field: RecipientField): string {
  const label = RECIPIENT_FIELD_LABEL[field]
  return `${label}${field === 'to' ? '으로' : '로'} 옮기기`
}

/** 작성창의 세 칸을 그대로 담은 상태 — 임시저장·발송이 쓰는 한 줄을 칸별로 나눠 가진다. */
export interface RecipientFields {
  to: string
  cc: string
  bcc: string
}

/**
 * 칸 문자열을 「굳힌 칩」 과 「아직 쓰는 중인 조각」 으로 나눈다(WP-2150 반려).
 *
 * 입력이 blur 되지 않은 채 칩을 옮기거나 빼면 칸 문자열에는 그 조각이 남아 있다 — 조각까지 칩으로 다시
 * 나누면 빨간 칩이 되어 입력에서 사라진다. 그래서 작성 도크가 지금 쓰는 조각을 함께 넘기면 그 조각만
 * 조각으로 친다(뒤에서 `joinRecipients` 로 다시 붙인다). 조각을 모르면 지금처럼 한 줄 전체를 칩으로 나눈다.
 */
export function splitField(value: string, rest = ''): { chips: RecipientChip[]; rest: string } {
  const tail = rest.trim()
  // 조각이 없으면 — 한 줄 전체가 굳힌 칩이다(지금까지의 동작 그대로).
  if (!tail) return { chips: toChips(value), rest: '' }
  // 칩 없이 조각만 남은 칸(조각 뒤에 붙일 칩이 아직 없음).
  if (value === tail) return { chips: [], rest: tail }
  const suffix = `, ${tail}`
  // 값이 조각을 담지 않으면(바깥이 값을 통째로 바꾼 뒤 등) 조각을 끼워 맞추지 않는다.
  if (!value.endsWith(suffix)) return { chips: toChips(value), rest: '' }
  return { chips: toChips(value.slice(0, value.length - suffix.length)), rest: tail }
}

/** 칸마다 아직 쓰는 중인 조각 — 옮기기·빼기가 칩만 다루게 작성 도크가 함께 넘긴다(WP-2150 반려). */
export type RecipientFieldRest = Partial<Record<RecipientField, string>>

/**
 * 칸 사이에서 칩 하나를 옮긴다 — 바뀐 두 칸만 새로 계산해 돌려준다(원본 인자는 바꾸지 않는다).
 *
 * 규칙(설계 5.1): 같은 칸에 놓으면 아무것도 안 하고, 옮길 인덱스가 없거나 칸 이름이 틀리면 원본을 그대로
 * 돌려준다(조용히 무시). 대상 칸에 같은 주소(`key`, 소문자)가 이미 있으면 대상은 건드리지 않고 원본에서만
 * 뺀다 — 같은 주소가 두 칸에 남지 않게(Gmail 과 같은 규칙). 빨간 칩(`ok: false`)도 형식 검사 없이 그대로
 * 옮긴다. 문자열은 기존 `toChips`·`joinRecipients` 로만 다뤄 파서를 새로 만들지 않는다.
 *
 * `rest` 를 받으면 그 칸의 쓰는 중인 조각을 남겨 넣는다 — 옮긴 뒤에도 그 글자는 입력에 그대로여야 한다(WP-2150 반려).
 */
export function moveRecipient(
  fields: RecipientFields,
  from: RecipientField,
  index: number,
  target: RecipientField,
  rest: RecipientFieldRest = {},
): RecipientFields {
  // 같은 칸에 놓으면 바뀔 것이 없음 — 원본을 그대로 준다(불변).
  if (from === target) return fields
  // 없는 칸 이름이면 조용히 무시 — 원본을 그대로 준다(타입을 우회한 호출 대비).
  if (typeof fields[from] !== 'string' || typeof fields[target] !== 'string') return fields

  const source = splitField(fields[from], rest[from])
  // 인덱스 밖이면 조용히 무시 — 원본을 그대로 준다.
  const moved = source.chips[index]
  if (!moved) return fields

  const destination = splitField(fields[target], rest[target])
  // 대상에 같은 주소가 이미 있으면 대상은 가만히다 — 같은 주소가 두 칸에 남지 않게 원본에서만 뺀다.
  const duplicate = destination.chips.some((c) => c.key === moved.key)
  const remaining = source.chips.filter((_, i) => i !== index)

  // 바뀐 두 칸만 새로 만든다 — 원본 fields 객체는 바꾸지 않는다(불변 유지). 쓰는 중인 조각은 그 자리에 남긴다.
  return {
    ...fields,
    [from]: joinRecipients(remaining, source.rest),
    [target]: duplicate ? fields[target] : joinRecipients([...destination.chips, moved], destination.rest),
  }
}

/**
 * 칸에서 칩 하나를 뺀다 — × 단추·메뉴 「빼기」 가 같은 경로를 쓰게 부모(MailComposeDock) 의 칸 상태를 고치는 데 쓴다(WP-2150).
 *
 * 규칙은 moveRecipient 와 같다(설계 5.1): 칸 이름이 틀리거나 인덱스 밖이면 원본을 그대로 돌려준다(조용히 무시),
 * 원본 인자는 바꾸지 않는다. 문자열은 기존 `toChips`·`joinRecipients` 로만 다뤄 파서를 새로 만들지 않는다.
 * 빨간 칩(`ok: false`)도 형식 검사 없이 그대로 뺀다. 칩과 아직 쓰는 조각을 함께 다루는 내부 `removeAt` 은
 * MailRecipientInput 안에 그대로 두고, 이 함수는 바깥(문자열) 상태에만 쓴다.
 *
 * `rest` 를 받으면 그 칸의 쓰는 중인 조각을 남겨 넣는다 — 뺀 뒤에도 그 글자는 입력에 그대로여야 한다(WP-2150 반려).
 */
export function removeRecipient(
  fields: RecipientFields,
  field: RecipientField,
  index: number,
  rest: RecipientFieldRest = {},
): RecipientFields {
  // 없는 칸 이름이면 조용히 무시 — 원본을 그대로 준다(타입을 우회한 호출 대비).
  if (typeof fields[field] !== 'string') return fields

  const { chips, rest: typed } = splitField(fields[field], rest[field])
  // 인덱스 밖이면 조용히 무시 — 원본을 그대로 준다.
  if (!chips[index]) return fields

  const remaining = chips.filter((_, i) => i !== index)
  // 바뀐 칸만 새로 만든다 — 원본 fields 객체는 바꾸지 않는다(불변 유지). 쓰는 중인 조각은 그 자리에 남긴다.
  return { ...fields, [field]: joinRecipients(remaining, typed) }
}
