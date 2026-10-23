// 이슈 목록 "열 고르기"(WP-270)의 열 모델 — 순수 로직(React·스토리지 접근 없음).
// 체크박스·상태·ID·제목·⋯ 는 항상 보이는 고정 열이라 키가 아니다. 여기서 다루는 것은 사용자가 켜고 끄는 "선택 열"뿐.
// URL `cols` 와 사용자별 저장값을 해석·정렬하는 규칙을 모아 단위 테스트로 지킨다(훅·열 정의는 이 모듈을 쓴다).

/** 내장 선택 열 키. */
export type BuiltinColumnKey =
  | 'priority'
  | 'assignee'
  | 'due'
  | 'closed'
  | 'start'
  | 'created'
  | 'updated'
  | 'reporter'
  | 'milestone'
  | 'cycle'

/** 선택 열 키 — 내장 키 또는 커스텀 필드 `cf<필드 id>`. */
export type IssueListColumnKey = BuiltinColumnKey | `cf${number}`

/** 설정이 없는 사람에게 보이는 기본 선택 열(지금 화면과 같은 구성). */
export const DEFAULT_COLUMNS: IssueListColumnKey[] = ['priority', 'assignee', 'due']

/** 내장 열의 표시 순서 — 선택 순서와 무관하게 항상 이 순서로 놓는다(커스텀 필드는 그 뒤). */
export const BUILTIN_ORDER: BuiltinColumnKey[] = [
  'priority',
  'assignee',
  'due',
  'closed',
  'start',
  'created',
  'updated',
  'reporter',
  'milestone',
  'cycle',
]

/** 열 구성을 싣는 URL 쿼리 파라미터 이름. */
export const COLS_PARAM = 'cols'

const BUILTIN_SET: ReadonlySet<string> = new Set(BUILTIN_ORDER)

/** 커스텀 필드 키 형식 — 양의 정수 id, 앞자리 0 없음(`cf07` 같은 비정규 표기는 모르는 키로 본다). */
const CUSTOM_KEY_RE = /^cf([1-9]\d*)$/

/** 키가 커스텀 필드 키면 그 필드 id, 아니면 null. */
export function customFieldIdOf(key: string): number | null {
  const m = CUSTOM_KEY_RE.exec(key)
  return m ? Number(m[1]) : null
}

/** 커스텀 필드 열 키(`cf<id>`)인가 — 필드 정의를 불러올지·열 정의를 어떻게 만들지 판정하는 곳들이 같은 규칙을 쓴다. */
export function isCustomColumnKey(key: string): key is `cf${number}` {
  return customFieldIdOf(key) !== null
}

/**
 * URL `cols` 값(CSV) 또는 개인 저장값(문자열 배열)을 열 키 배열로 해석한다 — 둘이 같은 검증 규칙을 쓰게 한 함수로 둔다.
 * - `null`(파라미터 없음) → null: 호출자가 개인 저장값/기본으로 넘어간다.
 * - `''`(`cols=`) → `[]`: "선택 열 모두 끔" — 부재와 구분해야 해서 빈 배열을 그대로 돌려준다.
 * - 모르는 키·중복은 버리고 입력 순서를 유지한다(표시 순서는 {@link orderColumns} 몫).
 * - 커스텀 필드는 `customFieldIds` 에 있는 것만 남긴다(삭제된 필드 키 무시). `customFieldIds` 가 null 이면
 *   (정의 로딩 중) 형식만 검사해 유지 — 로딩 전에 열이 사라졌다 되살아나는 깜빡임을 막는다.
 */
export function parseColumns(
  raw: string | readonly string[] | null,
  customFieldIds: number[] | null,
): IssueListColumnKey[] | null {
  if (raw === null) return null
  const known = customFieldIds === null ? null : new Set(customFieldIds)
  const seen = new Set<string>()
  const out: IssueListColumnKey[] = []
  // 문자열이면 URL 의 CSV, 배열이면 저장값 — 배열을 CSV 로 붙였다 다시 쪼개지 않고 바로 토큰으로 쓴다.
  for (const token of typeof raw === 'string' ? raw.split(',') : raw) {
    const key = token.trim()
    if (!key || seen.has(key)) continue
    const fieldId = customFieldIdOf(key)
    const valid = BUILTIN_SET.has(key) || (fieldId !== null && (known === null || known.has(fieldId)))
    if (!valid) continue
    seen.add(key)
    out.push(key as IssueListColumnKey)
  }
  return out
}

/** 열 키 배열을 URL `cols` 값으로 직렬화한다 — 빈 배열은 `''`(→ `cols=`)로 "모두 끔" 을 나타낸다. */
export function serializeColumns(keys: IssueListColumnKey[]): string {
  return keys.join(',')
}

/**
 * 표시 순서로 정렬한다 — 내장 열은 BUILTIN_ORDER, 그 뒤에 커스텀 필드를 정의 순서(`customFieldOrder`, position 순 id)로.
 * 정의 목록에 없는 커스텀 키(정의 로딩 중 등)는 버리지 않고 입력 순서대로 맨 뒤에 둔다. 중복은 한 번만 남긴다.
 */
export function orderColumns(keys: IssueListColumnKey[], customFieldOrder: number[]): IssueListColumnKey[] {
  const set = new Set<string>(keys)
  const builtins = BUILTIN_ORDER.filter((k) => set.has(k))
  const customs: IssueListColumnKey[] = []
  const placed = new Set<string>()
  const pushCustom = (key: string) => {
    if (!set.has(key) || placed.has(key)) return
    placed.add(key)
    customs.push(key as IssueListColumnKey)
  }
  for (const id of customFieldOrder) pushCustom(`cf${id}`)
  for (const key of keys) if (customFieldIdOf(key) !== null) pushCustom(key)
  return [...builtins, ...customs]
}

/**
 * 최종 열 구성 — URL ?? 저장값 ?? 기본 순으로 고른다(`??` 라 빈 배열 "모두 끔" 은 존중).
 * 완료일 필터가 켜졌는데 'closed' 가 없으면 결과가 보이도록 자동으로 더하고 `autoClosed=true`(UI 가 「필터로 켜짐」 표기).
 * `chosen` 은 사용자가 고른 열(표시 순서, 자동 완료일 열 제외) — 열 메뉴 토글·저장된 뷰 `cols` 의 기준이라 함께 돌려준다.
 */
export function resolveColumns(args: {
  url: IssueListColumnKey[] | null
  stored: IssueListColumnKey[] | null
  closedFilterActive: boolean
  customFieldOrder: number[]
}): { keys: IssueListColumnKey[]; chosen: IssueListColumnKey[]; autoClosed: boolean } {
  const picked = args.url ?? args.stored ?? DEFAULT_COLUMNS
  const autoClosed = args.closedFilterActive && !picked.includes('closed')
  const withClosed = autoClosed ? [...picked, 'closed' as const] : picked
  return {
    keys: orderColumns(withClosed, args.customFieldOrder),
    chosen: orderColumns(picked, args.customFieldOrder),
    autoClosed,
  }
}
