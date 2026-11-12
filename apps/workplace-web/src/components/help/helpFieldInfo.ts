// 포커스한 칸의 이름·값·비밀값 여부(WP-1511) — AI 화면 참고에 「사용자가 지금 만지는 칸」을 싣기 위한 순수 DOM 판정.
// 비밀값(토큰·비밀번호·키) 칸은 이름과 secret 표식만 내고 value 키 자체를 만들지 않는다 — 값이 AI·서버로 새지 않게 하는 마지막 방어선이다.
import { clip, LIMITS } from '@/lib/aiScreenContext/common'

import { CONTROL_SELECTOR, controlName, normalizeControlText } from './helpScreenControls'

/** 포커스한 칸 정보 — 비밀값이면 value 키가 없다. */
export type HelpFieldInfo = { name: string; secret: boolean; value?: string }

/**
 * 비밀값을 가리키는 낱말 — 라벨·name·id·aria-label·placeholder 를 이어 본다.
 * 「키」 단독(프로젝트 키·단축키)은 비밀이 아니므로 「API 키·접속 키·인증 키·개인 키」처럼 앞말이 붙은 것만 잡는다.
 */
const SECRET_PATTERN =
  /(비밀\s*번호|암호|토큰|시크릿|비밀\s*값|api\s*[-_]?\s*키|접속\s*키|인증\s*키|개인\s*키|password|passwd|passcode|secret|token|api[-_\s]?key|private[-_\s]?key|access[-_\s]?key)/i

/** 비밀로 보는 autocomplete 값. */
const SECRET_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code'])

/** 입력 칸 판정 — input·textarea·select·contenteditable. */
export const FIELD_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/** aria-labelledby 가 가리키는 요소들의 글을 이어 붙인다(없으면 빈 문자열). */
function labelledByText(el: Element): string {
  const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
  const doc = el.ownerDocument
  return normalizeControlText(ids.map((id) => doc.getElementById(id)?.textContent ?? '').join(' '))
}

/** 칸에 연결된 label 요소의 글 — for/id 연결(labels)과 감싸는 label 모두. 감싼 label 은 칸 자신의 글을 뺀다. */
function labelElementText(el: Element): string {
  const labels = (el as HTMLInputElement).labels
  const list = labels ? [...labels] : []
  if (list.length === 0) {
    const wrap = el.closest('label')
    if (wrap) list.push(wrap)
  }
  return normalizeControlText(list.map((l) => l.textContent ?? '').join(' '))
}

/**
 * 칸 이름 — label 요소 → aria-label → aria-labelledby 글 → placeholder → name 순으로 처음 비지 않은 것.
 * 사람이 화면에서 읽는 이름과 가깝게 하려는 순서다.
 */
export function fieldName(el: Element): string {
  return (
    labelElementText(el) ||
    normalizeControlText(el.getAttribute('aria-label')) ||
    labelledByText(el) ||
    normalizeControlText(el.getAttribute('placeholder')) ||
    normalizeControlText(el.getAttribute('name'))
  )
}

/**
 * 비밀값 칸인가. 우선순위: data-ai-secret 명시(true|false) > type=password·autocomplete 3종 > 이름 낱말 정규식.
 * 화면이 오탐·미탐을 직접 고칠 수 있게 data-ai-secret 이 최우선이다.
 */
export function isSecretField(el: Element): boolean {
  const flag = el.getAttribute('data-ai-secret')
  if (flag === 'true') return true
  if (flag === 'false') return false
  if (el.getAttribute('type')?.toLowerCase() === 'password') return true
  const auto = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/)
  if (auto.some((a) => SECRET_AUTOCOMPLETE.has(a))) return true
  const text = [labelElementText(el), el.getAttribute('name'), el.id, el.getAttribute('aria-label'), labelledByText(el), el.getAttribute('placeholder')]
    .filter(Boolean)
    .join(' ')
  return SECRET_PATTERN.test(text)
}

/** 칸의 현재 값 글 — select 는 고른 option 글, checkbox·radio 는 켜짐/꺼짐, contenteditable 은 textContent. */
function readValue(el: Element): string {
  if (el instanceof HTMLSelectElement) return normalizeControlText([...el.selectedOptions].map((o) => o.textContent).join(', '))
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '켜짐' : '꺼짐'
    return el.value
  }
  if (el instanceof HTMLTextAreaElement) return el.value
  return el.textContent ?? ''
}

/**
 * 비밀이 아닌 칸의 정보 — 값이 비면 value 키를 내지 않는다. 이름을 이미 알면(포커스 때 readFieldInfo 로 알아낸 {name, secret:false} 를 캐시해)
 * 입력 이벤트마다 이름·비밀 여부를 다시 가리지 않고 값만 다시 읽는 데도 쓴다. 비밀 칸에는 부르지 않는다.
 */
export function readFieldValue(field: Element, name: string): HelpFieldInfo {
  const value = clip(readValue(field), LIMITS.helpFocusValue)
  return value ? { name, secret: false, value } : { name, secret: false }
}

/**
 * 포커스한 요소 → 칸 정보. 입력 칸이면 이름·비밀 여부·값, 컨트롤(버튼 등)이면 이름만, 그 밖이거나 이름이 비면 null.
 * 비밀값이면 value 키를 아예 만들지 않는다(빈 값도 마찬가지로 키를 내지 않는다).
 * 호출자가 이미 찾았다면 found 로 넘겨 closest 탐색을 되풀이하지 않는다(undefined 면 여기서 찾는다, null 이면 「없음」).
 */
export function readFieldInfo(el: Element, found: { field?: Element | null; control?: Element | null } = {}): HelpFieldInfo | null {
  const field = found.field === undefined ? el.closest(FIELD_SELECTOR) : found.field
  if (field) {
    const name = clip(fieldName(field), LIMITS.helpFocusName)
    if (!name) return null
    if (isSecretField(field)) return { name, secret: true }
    return readFieldValue(field, name)
  }
  const control = found.control === undefined ? el.closest(CONTROL_SELECTOR) : found.control
  if (control) {
    const name = clip(controlName(control), LIMITS.helpFocusName)
    return name ? { name, secret: false } : null
  }
  return null
}

/** 대화상자 이름 — aria-labelledby 글, 없으면 aria-label. 둘 다 없으면 null. */
export function dialogName(el: Element): string | null {
  return labelledByText(el) || normalizeControlText(el.getAttribute('aria-label')) || null
}
