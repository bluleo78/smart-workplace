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
