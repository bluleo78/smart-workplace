// 메일 받는사람에 조직·내 그룹 넣기(WP-1060) — 후보로 보일 부서·내 그룹 고르기, 보이는 인원 수, 고를 때 구성원 주소 칩으로 풀기, 결과 안내 문구.
// 줄의 「N명」은 서버가 구성원 찾기와 같은 규칙으로 센 수(WP-1135)이고, 풀기는 그 찾기 결과(groupRecipients)를 쓴다 — 고른 뒤 넣은 수·뺀 수·주소 없는 수의 합과 같게.
import type { GroupOption } from '../components/members/groupOptions'
import type { UserGroupMemberHit } from '../types/userGroup'
import { type RecipientChip, toChip } from './mailRecipientSuggest'

/** 그룹 종류 — 조직도 부서(공유) · 내 그룹(개인). */
export type RecipientGroupKind = 'department' | 'personal'

/** 그룹 종류 꼬리표 — 후보 줄 오른쪽(사람 후보의 「구성원」·「주소록」 자리). */
export const RECIPIENT_GROUP_KIND_LABEL: Record<RecipientGroupKind, string> = {
  department: '조직',
  personal: '내 그룹',
}

/** 받는사람 후보로 보일 부서·내 그룹 한 줄. */
export interface RecipientGroupSuggestion {
  id: number
  kind: RecipientGroupKind
  name: string
  /** 상위 그룹 이름(「경영지원본부」), 최상위면 빈 문자열 */
  path: string
  /** 하위 그룹이 있는지 — 「하위 부서 포함」 안내를 붙인다 */
  hasChildren: boolean
  /** 하위 그룹까지 센 인원(전체·외부 연락처, WP-1135) — 아직 세는 중이면 undefined(그동안은 고를 수 없다) */
  count: { total: number; external: number } | undefined
  /** 인원을 세지 못했는지 — 줄에 그 사실을 보인다(고르면 구성원을 새로 받아 다시 해 본다) */
  failed: boolean
}

/** 후보로 고를 그룹 — 종류를 붙인 평면 그룹 줄. */
export interface RecipientGroupOption extends GroupOption {
  kind: RecipientGroupKind
}

/**
 * 쓰는 조각(대소문자 무시)이 **이름**에 든 그룹을 고른다 — 이름이 조각으로 시작하는 그룹을 앞으로(그 안은 조직도 → 내 그룹, 트리 순서 그대로), limit 개까지.
 * 상위 경로로는 찾지 않는다 — 「경영」을 치면 경영지원본부 아래 모든 팀이 사람 후보를 밀어내지 않게.
 */
export function matchRecipientGroups(options: RecipientGroupOption[], query: string, limit: number): RecipientGroupOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return options
    .map((o) => ({ o, at: o.name.toLowerCase().indexOf(q) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => Number(a.at > 0) - Number(b.at > 0))
    .slice(0, limit)
    .map(({ o }) => o)
}

/**
 * 그룹을 풀 때 대상이 되는 사람들 — 같은 사람(종류·id)은 한 번만. 서버(하위 조직 포함 구성원 찾기)가 이미 한 사람을 한 줄로 주지만, 인원 수와 풀기가
 * 반드시 같은 목록을 쓰도록 여기 한 곳에서 정한다. 주소가 없는 사람도 센다(고르면 「주소가 없어 넣지 못했다」고 알린다).
 */
export function groupRecipients(members: UserGroupMemberHit[]): UserGroupMemberHit[] {
  const seen = new Set<string>()
  return members.filter((m) => {
    const key = `${m.targetType}:${m.targetId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 그룹을 풀어 넣은 결과. */
export interface GroupExpansion {
  /** 새로 넣을 칩 — 구성원 순서 그대로 */
  chips: RecipientChip[]
  /** 이 칸에 이미 있어 뺀 사람 수 — 그룹 안에서 같은 주소가 겹친 것은 세지 않는다(「이미 들어 있는」으로 알리면 틀리므로) */
  skipped: number
  /** 메일 주소가 없어 넣지 못한 사람 이름 */
  noAddress: string[]
}

/**
 * 그룹을 고른 순간의 구성원 → 이 칸에 넣을 주소 칩(WP-1060). 이미 이 칸에 있는 주소(existingKeys, 소문자)는 빼고 skipped 로 세고,
 * 그룹 안에서 겹치는 주소(두 사람이 같은 주소 등)는 조용히 한 번만 넣는다.
 * 주소가 없는 사람(외부 연락처 주소 미등록 등)은 넣지 않고 이름을 돌려준다. 외부 연락처도 주소가 있으면 사람처럼 넣는다.
 */
export function expandGroupRecipients(members: UserGroupMemberHit[], existingKeys: ReadonlySet<string>): GroupExpansion {
  // 이 칸에 이미 있는 주소(existingKeys)와 그룹 안에서 이미 본 주소(seen)를 따로 본다 — 앞의 것만 「이미 들어 있는」 수에 든다.
  const seen = new Set<string>()
  const chips: RecipientChip[] = []
  const noAddress: string[] = []
  let skipped = 0
  for (const m of groupRecipients(members)) {
    const address = m.email?.trim()
    if (!address) {
      noAddress.push(m.name)
      continue
    }
    const chip = toChip({ address, name: m.name || null })
    // 그룹 안에서 앞서 본 주소면(넣었든 이미 있어 뺐든) 조용히 넘긴다.
    if (seen.has(chip.key)) continue
    seen.add(chip.key)
    if (existingKeys.has(chip.key)) {
      skipped++
      continue
    }
    chips.push(chip)
  }
  return { chips, skipped, noAddress }
}

/** 안내에 이름까지 적는 최대 인원 — 넘으면 수만 말한다(토스트가 길어지지 않게). */
const NAMED_LIMIT = 3

/**
 * 그룹을 풀어 넣은 뒤의 안내(WP-1060) — 「개발팀에서 10명을 넣었습니다. 이미 들어 있는 1명은 빼고, 메일 주소가 없는 1명(정AI)은 넣지 못했습니다.」
 * 주소가 없는 사람은 적을 때만 이름을 적는다.
 */
export function groupExpansionToast(groupName: string, { chips, skipped, noAddress }: GroupExpansion): string {
  const head =
    chips.length > 0
      ? `${groupName}에서 ${chips.length}명을 넣었습니다.`
      : skipped + noAddress.length > 0
        ? `${groupName}에서 새로 넣을 주소가 없습니다.`
        : `${groupName}에 넣을 구성원이 없습니다.`
  const missing =
    noAddress.length > 0
      ? `메일 주소가 없는 ${noAddress.length}명${noAddress.length <= NAMED_LIMIT ? `(${noAddress.join(', ')})` : ''}은 넣지 못했습니다.`
      : null
  if (skipped > 0 && missing) return `${head} 이미 들어 있는 ${skipped}명은 빼고, ${missing}`
  if (skipped > 0) return `${head} 이미 들어 있는 ${skipped}명은 뺐습니다.`
  if (missing) return `${head} ${missing}`
  return head
}
