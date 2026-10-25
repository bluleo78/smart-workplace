// 서버 메일함(보관·내 메일함) 순수 로직(WP-961) — 사이드바 트리 조립·접힘 펼침·경로·가져온 기간.
// 화면(MailSidebar)·보기 해석(mailView)·메일함 화면(MailInboxPage)이 같은 규칙을 쓰도록 여기 한 곳에 둔다.
import type { MailServerFolder } from '@/types/mailFolder'

/** 트리 노드 — 메일함 한 개와 그 하위 메일함. */
export interface MailFolderNode {
  folder: MailServerFolder
  children: MailFolderNode[]
}

/** 화면에 그릴 한 줄 — 깊이(들여쓰기)와 접기 버튼 여부·펼침 상태를 함께 담는다. */
export interface MailFolderRow {
  folder: MailServerFolder
  depth: number
  hasChildren: boolean
  expanded: boolean
}

/** 들여쓰기 상한 — 깊은 계층에서도 이름 칸이 사이드바 폭을 넘치지 않게 이 깊이부터는 더 들이지 않는다. */
export const MAX_INDENT_DEPTH = 4

/** 깊이 → 왼쪽 여백(px). 상한 이후는 같은 여백. */
export function folderIndentPx(depth: number): number {
  return 6 + Math.min(depth, MAX_INDENT_DEPTH) * 12
}

/** 메일함 이름 비교 — 한국어 사전순, 숫자는 크기순(「2월」 < 「10월」). */
const folderNameCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })
const byFolderName = (a: MailServerFolder, b: MailServerFolder) =>
  folderNameCollator.compare(a.displayName, b.displayName) || a.id - b.id

/**
 * 목록 → 보관 + 내 메일함 트리.
 * - 보관은 기본 메일함 줄에 납작하게 그리므로 첫 ARCHIVE 하나만 따로 뺀다(서버는 계정당 하나를 준다 — 둘 이상이면 나머지는 보이지 않는다).
 * - 부모가 USER 목록에 없으면(보관 아래·숨은 부모·지워진 부모) 최상위로 올린다 — 메일함이 트리에서 사라지지 않게.
 * - 메일을 담지 못하고 하위도 없는 메일함(selectable=false 잎)은 열 것이 없어 뺀다.
 * - 부모 고리가 꼬여 있어도(서버 데이터 이상) 각 메일함은 한 번만 붙는다.
 * 형제 순서는 한국어 이름순(숫자는 크기순)이다 — 서버 DB 정렬 규칙(en_US)은 한글 순서를 뒤섞어 화면에서 다시 맞춘다.
 */
export function buildMailFolderTree(folders: readonly MailServerFolder[]): {
  archive: MailServerFolder | null
  tree: MailFolderNode[]
} {
  const archive = folders.find((f) => f.role === 'ARCHIVE') ?? null
  const users = folders.filter((f) => f.role === 'USER')
  const byId = new Map(users.map((f) => [f.id, f]))
  const childrenOf = new Map<number, MailServerFolder[]>()
  const roots: MailServerFolder[] = []
  for (const f of users) {
    if (f.parentId != null && f.parentId !== f.id && byId.has(f.parentId)) {
      const list = childrenOf.get(f.parentId) ?? []
      list.push(f)
      childrenOf.set(f.parentId, list)
    } else {
      roots.push(f)
    }
  }
  const placed = new Set<number>()
  const build = (f: MailServerFolder): MailFolderNode | null => {
    if (placed.has(f.id)) return null
    placed.add(f.id)
    const children = (childrenOf.get(f.id) ?? []).map(build).filter((n): n is MailFolderNode => n != null)
    if (!f.selectable && children.length === 0) return null
    return { folder: f, children }
  }
  for (const list of childrenOf.values()) list.sort(byFolderName)
  roots.sort(byFolderName)
  const tree = roots.map(build).filter((n): n is MailFolderNode => n != null)
  // 고리에 갇혀 최상위에 닿지 못한 메일함(A↔B 서로 부모)도 최상위로 살린다.
  for (const f of users) {
    if (!placed.has(f.id)) {
      const n = build(f)
      if (n) tree.push(n)
    }
  }
  return { archive, tree }
}

/** 트리 → 화면 줄. 접힌 메일함의 하위는 건너뛴다(기본은 펼침 — collapsed 에 있는 것만 접힌다). */
export function visibleFolderRows(tree: readonly MailFolderNode[], collapsed: ReadonlySet<number>): MailFolderRow[] {
  const rows: MailFolderRow[] = []
  const walk = (nodes: readonly MailFolderNode[], depth: number) => {
    for (const n of nodes) {
      const hasChildren = n.children.length > 0
      const expanded = hasChildren && !collapsed.has(n.folder.id)
      rows.push({ folder: n.folder, depth, hasChildren, expanded })
      if (expanded) walk(n.children, depth + 1)
    }
  }
  walk(tree, 0)
  return rows
}

/** 메일함의 조상 id(가까운 순) — 지금 연 메일함이 접힌 부모에 숨지 않게 펼칠 때 쓴다. */
export function folderAncestorIds(folders: readonly MailServerFolder[], id: number): number[] {
  const byId = new Map(folders.filter((f) => f.role === 'USER').map((f) => [f.id, f]))
  const out: number[] = []
  let cur = byId.get(id)?.parentId ?? null
  while (cur != null && byId.has(cur) && !out.includes(cur) && cur !== id) {
    out.push(cur)
    cur = byId.get(cur)?.parentId ?? null
  }
  return out
}

/** 메일함 이름 경로(최상위 → 자신). 보관은 「보관」 한 칸. 목록에 없으면 빈 배열. */
export function folderNamePath(folders: readonly MailServerFolder[], id: number): string[] {
  const f = folders.find((x) => x.id === id)
  if (!f) return []
  if (f.role === 'ARCHIVE') return [ARCHIVE_LABEL]
  const byId = new Map(folders.map((x) => [x.id, x]))
  return [...folderAncestorIds(folders, id)].reverse().map((a) => byId.get(a)!.displayName).concat(f.displayName)
}

/** 보관 메일함의 화면 이름 — 서버 이름(Archive·보관함 등)과 무관하게 같은 이름으로 보인다. */
export const ARCHIVE_LABEL = '보관'

/**
 * 가져온 기간(일) — 마지막으로 가져온 시각부터 가장 오래된 경계까지. 「더 가져오기」를 누를 때마다 늘어난다(90 → 180 …).
 * 지금 시각이 아니라 가져온 시각 기준이라 렌더마다 값이 흔들리지 않는다. 둘 중 하나라도 없으면 null.
 */
export function folderRangeDays(f: Pick<MailServerFolder, 'syncedSince' | 'folderSyncedAt'>): number | null {
  if (!f.syncedSince || !f.folderSyncedAt) return null
  const ms = Date.parse(f.folderSyncedAt) - Date.parse(f.syncedSince)
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.max(1, Math.round(ms / 86_400_000))
}

/** 접힌 메일함 저장 키(계정별). */
export function collapsedStorageKey(accountId: number): string {
  return `mail-folder-collapsed:${accountId}`
}

/** 저장된 접힘 집합 읽기 — 저장소를 못 쓰거나 값이 깨졌으면 빈 집합(모두 펼침). */
export function readCollapsed(accountId: number): Set<number> {
  try {
    const raw = localStorage.getItem(collapsedStorageKey(accountId))
    const arr: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((v): v is number => typeof v === 'number') : [])
  } catch {
    return new Set()
  }
}

/** 접힘 집합 저장 — 저장소를 못 쓰면(사생활 보호 창 등) 이번 화면에서만 유지된다. */
export function writeCollapsed(accountId: number, collapsed: ReadonlySet<number>): void {
  try {
    localStorage.setItem(collapsedStorageKey(accountId), JSON.stringify([...collapsed]))
  } catch {
    /* 저장 실패는 무시 — 접힘은 편의 상태다 */
  }
}
