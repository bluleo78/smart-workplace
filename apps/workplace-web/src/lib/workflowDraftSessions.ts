/** 사용자·테넌트·프로젝트 범위의 워크플로우 초안을 현재 브라우저 탭에서 공유한다. */
export interface WorkflowDraftEdit {
  yaml: string
  expectedDraftUpdatedAt: string
  baseYaml: string
}

export interface WorkflowDraftSession {
  edit: WorkflowDraftEdit | null
  conflict: boolean
}

export const WORKFLOW_DRAFT_STORAGE_PREFIX = 'workflow-drafts:'

const emptySessions: ReadonlyMap<number, WorkflowDraftSession> = new Map()
const snapshots = new Map<string, ReadonlyMap<number, WorkflowDraftSession>>()
const snapshotStorageValues = new Map<string, string | null | undefined>()
const listeners = new Map<string, Set<() => void>>()
const eligibleWorkflowIds = new Map<string, ReadonlySet<number>>()
const storageWritable = new Map<string, boolean>()
let draftGeneration = 0

/** 사용자 식별 정보가 없을 때는 다른 세션과 공유될 저장 키를 만들지 않는다. */
export function workflowDraftStorageKey(userId: number | undefined, tenantId: number | undefined, projectId: number): string | null {
  if (userId === undefined) return null
  return `${WORKFLOW_DRAFT_STORAGE_PREFIX}${userId}:${tenantId ?? 'none'}:${projectId}`
}

/** 저장소 데이터는 탭 복귀 때 쓰므로 구조가 확인된 초안만 복원한다. */
export function readWorkflowDraftSessions(key: string | null): ReadonlyMap<number, WorkflowDraftSession> {
  if (key === null) return new Map()
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? 'null')
    if (!Array.isArray(value)) return new Map()
    const entries = value.filter((entry): entry is [number, WorkflowDraftSession] => {
      if (!Array.isArray(entry) || typeof entry[0] !== 'number' || !entry[1] || typeof entry[1] !== 'object') return false
      const session = entry[1] as Partial<WorkflowDraftSession>
      if (typeof session.conflict !== 'boolean') return false
      if (session.edit === null) return true
      const edit = session.edit as Partial<WorkflowDraftEdit> | undefined
      return !!edit && typeof edit.yaml === 'string'
        && typeof edit.expectedDraftUpdatedAt === 'string' && typeof edit.baseYaml === 'string'
    })
    return new Map(entries)
  } catch {
    return new Map()
  }
}

/** React 구독자는 같은 사용자 범위의 다른 화면이나 늦은 요청 결과도 바로 받는다. */
export function subscribeWorkflowDraftSessions(key: string | null, listener: () => void): () => void {
  if (key === null) return () => {}
  const subscribers = listeners.get(key) ?? new Set<() => void>()
  subscribers.add(listener)
  listeners.set(key, subscribers)
  return () => {
    subscribers.delete(listener)
    if (subscribers.size === 0) listeners.delete(key)
  }
}

/** sessionStorage가 외부에서 바뀐 경우도 감지하면서 React에 안정된 스냅샷을 돌려준다. */
export function getWorkflowDraftSessions(key: string | null): ReadonlyMap<number, WorkflowDraftSession> {
  if (key === null) return emptySessions
  const storedValue = readStorageValue(key)
  const current = snapshots.get(key)
  if (current && storageWritable.get(key) === false) return current
  if (current && (storedValue === undefined || snapshotStorageValues.get(key) === storedValue)) return current
  const next = readWorkflowDraftSessions(key)
  snapshots.set(key, next)
  snapshotStorageValues.set(key, storedValue)
  return next
}

/** 저장 결과를 호출자에게 알려 세션 저장 실패와 메모리 초안 상태를 구분한다. */
export function writeWorkflowDraftSessions(key: string | null, sessions: ReadonlyMap<number, WorkflowDraftSession>): boolean {
  if (key === null) return false
  try {
    if (sessions.size === 0) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, JSON.stringify([...sessions.entries()]))
    return true
  } catch {
    // 세션 저장소를 쓸 수 없는 브라우저에서는 현재 화면 입력을 계속 허용한다.
    return false
  }
}

/** 한 워크플로우의 편집만 최신 탭 상태에 반영해, 오래된 콜백이 다른 초안을 덮지 않게 한다. */
export function updateWorkflowDraftSession(
  key: string | null,
  workflowId: number,
  session: WorkflowDraftSession | null,
  expectedGeneration = draftGeneration,
): boolean {
  if (key === null || expectedGeneration !== draftGeneration) return false
  const allowed = eligibleWorkflowIds.get(key)
  if (session && allowed && !allowed.has(workflowId)) return false
  const next = new Map(getWorkflowDraftSessions(key))
  if (session) next.set(workflowId, session)
  else next.delete(workflowId)
  return publishWorkflowDraftSessions(key, next)
}

/** 확정된 목록·권한으로 삭제·읽기 전용 초안을 비우고 이후 늦은 쓰기도 막는다. */
export function pruneWorkflowDraftSessions(
  key: string | null,
  workflowIds: ReadonlySet<number>,
  canManage: boolean,
): void {
  if (key === null) return
  const allowed = canManage ? workflowIds : new Set<number>()
  eligibleWorkflowIds.set(key, allowed)
  const current = getWorkflowDraftSessions(key)
  if ([...current.keys()].every((workflowId) => allowed.has(workflowId))) return
  const next = new Map([...current].filter(([workflowId]) => allowed.has(workflowId)))
  publishWorkflowDraftSessions(key, next)
}

/** 인증 요청 시작 때 세대를 잡아 로그아웃 뒤 도착한 결과를 구별한다. */
export function getWorkflowDraftGeneration(): number {
  return draftGeneration
}

/** 로그인·테넌트 전환 경계에서 이전 요청 결과만 무효화하고 사용자별 저장 초안은 보존한다. */
export function invalidateWorkflowDraftSessions(): void {
  draftGeneration++
}

/** 로그아웃 때 현재 탭에 남은 워크플로 초안만 제거해 다음 사용자의 입력과 분리한다. */
export function clearWorkflowDraftSessions(): void {
  invalidateWorkflowDraftSessions()
  const keys = new Set([...snapshots.keys(), ...listeners.keys(), ...eligibleWorkflowIds.keys()])
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(WORKFLOW_DRAFT_STORAGE_PREFIX)) keys.add(key)
    }
  } catch {
    // 브라우저 저장소에 접근할 수 없는 환경은 저장된 초안도 없다.
  }
  for (const key of keys) {
    if (!key.startsWith(WORKFLOW_DRAFT_STORAGE_PREFIX)) continue
    try {
      window.sessionStorage.removeItem(key)
    } catch {
      // 다음 로그인에서 세대가 달라 이전 요청이 저장소를 되살릴 수 없다.
    }
    snapshots.set(key, emptySessions)
    snapshotStorageValues.set(key, null)
    storageWritable.set(key, true)
    eligibleWorkflowIds.delete(key)
    notifyWorkflowDraftSessions(key)
  }
}

/** 저장과 메모리 스냅샷을 함께 바꾸고 해당 화면 구독자에게 알린다. */
function publishWorkflowDraftSessions(key: string, sessions: ReadonlyMap<number, WorkflowDraftSession>): boolean {
  snapshots.set(key, sessions)
  const saved = writeWorkflowDraftSessions(key, sessions)
  storageWritable.set(key, saved)
  snapshotStorageValues.set(key, saved ? readStorageValue(key) : undefined)
  notifyWorkflowDraftSessions(key)
  return saved
}

/** 저장소 안의 초안 변경을 같은 사용자 범위의 화면에 알려 생명주기 밖 응답도 반영한다. */
function notifyWorkflowDraftSessions(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener()
}

/** sessionStorage 접근 실패를 undefined 로 돌려 저장 불가 상태와 빈 저장값을 구분한다. */
function readStorageValue(key: string): string | null | undefined {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return undefined
  }
}
