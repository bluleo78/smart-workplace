// 이슈 관계 화면 로직(WP-887) — 레일 묶음·관계 추가 창·관리 화면이 함께 쓰는 순수 함수.
// 말(label)은 「이 이슈는 ___」의 서술어다. 방향 있는 유형은 A 쪽(source)·B 쪽(target) 말이 다르고, 방향 없는 유형은 하나.
import type {
  IssueLinkSummary,
  IssueRelationSide,
  IssueRelationType,
  IssueRelationTypeAdmin,
  IssueRelationView,
} from '../types/issue'

/** 차단 유형 코드 — 저장은 의존성(issue_dependency)이라 추가·삭제가 의존성 API 로 간다. */
export const BLOCKS_CODE = 'BLOCKS'

/** 차단 B 쪽 말에 화면에서만 덧붙이는 설명 — 지금 「차단됨 (선행 필요)」 묶음 제목을 그대로 잇는다. */
const BLOCKED_BY_LABEL = '차단됨 (선행 필요)'

/**
 * 화면에 보일 말 — 차단의 B 쪽(「차단됨」)만 「차단됨 (선행 필요)」로 덧붙인다. 레일 묶음·추가 창·관리 표가 같은 규칙을 쓴다.
 * 차단 유형은 이름·말을 바꿀 수 없어 서버 말 「차단됨」과 비교해도 된다.
 */
export function displayRelationLabel(typeCode: string | null | undefined, label: string): string {
  return typeCode === BLOCKS_CODE && label === '차단됨' ? BLOCKED_BY_LABEL : label
}

/** 「이 이슈는…」 선택지 한 개 — 유형 + 이 이슈가 어느 쪽인지. */
export interface RelationOption {
  typeId: number
  side: IssueRelationSide
  label: string
  typeCode: string | null
  externalOnly: boolean
}

/** 선택지 식별자 — Select 값으로 쓴다. */
export const relationOptionKey = (o: Pick<RelationOption, 'typeId' | 'side'>) => `${o.typeId}:${o.side}`

/** 유형 정렬 — 서버 정렬 순(sortOrder), 같으면 id(만든 순). */
function byTypeOrder(a: IssueRelationType, b: IssueRelationType): number {
  return a.sortOrder - b.sortOrder || a.id - b.id
}

/**
 * 「이 이슈는…」 선택지 — 숨긴 유형은 빼고 정렬 순으로, 방향 있는 유형은 A 쪽·B 쪽 두 개(B 쪽 말이 없는 외부 전용 「에픽에 속함」은 하나),
 * 방향 없는 유형은 하나. 외부 전용 유형도 포함한다 — 이슈 탭은 externalOnly 를 걸러 쓴다.
 * keep 은 고치는 중인 링크의 지금 선택지 — 숨긴 유형이어도 그 한 개(그 쪽만)는 남겨 수정 창이 지금 값을 보이게 한다.
 */
export function relationOptions(
  types: readonly IssueRelationType[],
  keep?: Pick<RelationOption, 'typeId' | 'side'>,
): RelationOption[] {
  return [...types]
    .filter((t) => !t.hidden || t.id === keep?.typeId)
    .sort(byTypeOrder)
    .flatMap((t) => {
      const base = { typeId: t.id, typeCode: t.code, externalOnly: t.externalOnly }
      const out: RelationOption[] = [{ ...base, side: 'source', label: t.outwardLabel }]
      if (t.directed && t.inwardLabel) {
        out.push({ ...base, side: 'target', label: displayRelationLabel(t.code, t.inwardLabel) })
      }
      return t.hidden ? out.filter((o) => o.side === keep?.side) : out
    })
}

/** 이슈 키 꼴 — 영문 대문자로 시작하는 프로젝트 키 + 하이픈 + 번호(Jira·우리 키 모두). */
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/

/**
 * 외부 주소에서 이슈 키를 뽑아 본다 — 키 칸을 미리 채우는 용도(사람이 고칠 수 있다). 순서: Jira `…/browse/KEY-n`,
 * 경로 끝 조각이 키 꼴, Jira 보드의 `selectedIssue=KEY-n`. 못 찾거나 주소가 아니면 null.
 */
export function extractKeyFromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  const segments = parsed.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s))
  const browse = segments.indexOf('browse')
  if (browse >= 0 && ISSUE_KEY.test(segments[browse + 1] ?? '')) return segments[browse + 1]
  const last = segments.at(-1) ?? ''
  if (ISSUE_KEY.test(last)) return last
  const selected = parsed.searchParams.get('selectedIssue') ?? ''
  return ISSUE_KEY.test(selected) ? selected : null
}

/** 레일 한 줄 — 차단은 의존성 API(번호·방향)로, 관계는 관계 id 로 지운다. */
export type RelationRow =
  | { kind: 'blocking'; direction: 'blockedBy' | 'blocks'; link: IssueLinkSummary }
  | { kind: 'relation'; relation: IssueRelationView }

/** 레일의 말 묶음 — 같은 유형·같은 말의 줄을 모은다. */
export interface RelationGroup {
  /** 묶음 식별자 — 차단은 'blockedBy'·'blocks', 관계는 `${typeId}-${side}`(이 이슈가 A 쪽이면 source). */
  key: string
  /** 목록 testid — 차단 묶음은 기존 E2E 계약(blocked-by-list·blocks-list), 관계는 `issue-relation-group-${key}`. */
  testId: string
  label: string
  rows: RelationRow[]
}

/**
 * 레일 묶음 — 줄이 있는 말만, 순서는 차단됨 → 차단 중 → 유형 정렬 순(같은 유형은 A 쪽 말 먼저). 묶음은 유형 + 이 이슈 쪽(서버가 준 side)으로 나눈다.
 * types 가 없으면(유형 목록을 아직 못 받음) 유형 id 순 — 기본 유형이 먼저 만들어져 정렬 순과 대개 같다.
 * 외부 링크는 따로 「외부 링크」 묶음으로 그리므로 여기 넣지 않는다.
 */
export function groupRelations(
  blockedBy: readonly IssueLinkSummary[],
  blocks: readonly IssueLinkSummary[],
  relations: readonly IssueRelationView[],
  types?: readonly IssueRelationType[],
): RelationGroup[] {
  const groups: RelationGroup[] = []
  if (blockedBy.length > 0) {
    groups.push({
      key: 'blockedBy',
      testId: 'blocked-by-list',
      label: BLOCKED_BY_LABEL,
      rows: blockedBy.map((link) => ({ kind: 'blocking', direction: 'blockedBy', link })),
    })
  }
  if (blocks.length > 0) {
    groups.push({
      key: 'blocks',
      testId: 'blocks-list',
      label: '차단 중',
      rows: blocks.map((link) => ({ kind: 'blocking', direction: 'blocks', link })),
    })
  }

  const typeById = new Map((types ?? []).map((t) => [t.id, t]))
  const byKey = new Map<string, { typeId: number; side: IssueRelationSide; label: string; rows: RelationRow[] }>()
  for (const relation of relations) {
    const side = relation.side
    const key = `${relation.typeId}-${side}`
    const group = byKey.get(key) ?? { typeId: relation.typeId, side, label: relation.label, rows: [] }
    group.rows.push({ kind: 'relation', relation })
    byKey.set(key, group)
  }
  // 정렬 키 — (유형 정렬 순, 유형 id, A 쪽 먼저).
  const order = (typeId: number) => typeById.get(typeId)?.sortOrder ?? 0
  const sorted = [...byKey.entries()].sort(
    ([, a], [, b]) =>
      order(a.typeId) - order(b.typeId) || a.typeId - b.typeId || (a.side === b.side ? 0 : a.side === 'source' ? -1 : 1),
  )
  for (const [key, g] of sorted) groups.push({ key, testId: `issue-relation-group-${key}`, label: g.label, rows: g.rows })
  return groups
}

/** 관계 상대의 표시 키 — 같은 프로젝트면 `#12`, 다른 프로젝트면 `WPV-28`. */
export function relatedIssueKey(rowProjectKey: string, currentProjectKey: string, number: number): string {
  return rowProjectKey === currentProjectKey ? `#${number}` : `${rowProjectKey}-${number}`
}

/**
 * 쓰이는 유형을 지울 때 관계를 옮길 수 있는 유형 — 자기 자신·차단(의존성으로 저장)·외부 전용·숨긴 유형, 그리고 방향 없는 유형에서 옮길 때의 방향 있는 유형을 뺀다(서버도 같은 규칙으로 거절).
 */
export function relationTypeMoveTargets<T extends IssueRelationType>(types: readonly T[], target: Pick<T, 'id' | 'directed'>): T[] {
  // 방향 없는 유형의 관계는 A·B 가 정해져 있지 않아 방향 있는 유형으로 옮길 수 없다(서버도 400).
  return types.filter(
    (t) => t.id !== target.id && t.code !== BLOCKS_CODE && !t.externalOnly && !t.hidden && (target.directed || !t.directed),
  )
}

/** 유형이 쓰이는 곳 수 — 이슈 사이 관계 + 외부 링크. 관리 표·삭제 창·편집 창이 같은 합을 쓴다. */
export function relationTypeUsage(t: Pick<IssueRelationTypeAdmin, 'relationCount' | 'externalLinkCount'>): number {
  return t.relationCount + t.externalLinkCount
}
