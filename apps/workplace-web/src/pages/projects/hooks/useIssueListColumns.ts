// 이슈 목록 선택 열 구성 훅(WP-270) — URL `cols` → 개인 저장값 → 기본 순으로 고른 열과, 열을 바꾸고 되돌리는 동작.
// 목록(ProjectIssuesSection)·열 메뉴(IssueFilterBar)·저장된 뷰 일치·페이로드(useSavedViewState)가 각자 이 훅을 부른다.
// 세 인스턴스가 같은 값을 보도록 URL 은 라우터가, 개인 저장값은 모듈 단위 구독(useSyncExternalStore)이 공유한다 —
// 인스턴스별 useState 였다면 열 메뉴에서 바꾼 값이 목록·뷰 저장에 닿지 않는다.
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { safeLocalStorage } from '@/lib/safeLocalStorage'
import { userScopedKey } from '@/lib/userScopedKey'

import { useCustomFields } from '../../../hooks/queries/useCustomFields'
import {
  COLS_PARAM,
  DEFAULT_COLUMNS,
  isCustomColumnKey,
  type IssueListColumnKey,
  orderColumns,
  parseColumns,
  resolveColumns,
  serializeColumns,
} from '../../../lib/issueListColumns'

const STORAGE_BASE = 'issue-list-columns'

// 같은 탭의 구독자 — 저장값을 바꾸면 모두 다시 읽는다(같은 탭 변경엔 storage 이벤트가 뜨지 않는다).
const listeners = new Set<() => void>()
// 저장소에 쓰지 못했을 때(사생활 보호 모드 등)만 쓰는 이 탭 한정 값 — 쓰기에 성공하면 비운다.
// 평소엔 비어 있어 스냅샷이 언제나 localStorage 원문이다(문자열이라 값 비교로 충분 — 캐시 불필요).
const memoryFallback = new Map<string, string | null>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // 다른 탭에서 바꾼 열 설정도 반영한다.
  const onStorage = (e: StorageEvent) => {
    if (e.key == null || e.key.startsWith(STORAGE_BASE)) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

/** 저장 원문(JSON 문자열) — 없거나 읽을 수 없으면 null. */
function readRaw(storageKey: string): string | null {
  if (memoryFallback.has(storageKey)) return memoryFallback.get(storageKey) ?? null
  try {
    return safeLocalStorage()?.getItem(storageKey) ?? null
  } catch {
    return null
  }
}

/** 원문을 쓰거나(null 이면 지우고) 구독자에게 알린다. 저장소가 막혔으면 이 탭에서만 기억한다. */
function writeRaw(storageKey: string, value: string | null): void {
  try {
    const storage = safeLocalStorage()
    if (!storage) throw new Error('no storage')
    if (value === null) storage.removeItem(storageKey)
    else storage.setItem(storageKey, value)
    memoryFallback.delete(storageKey)
  } catch {
    memoryFallback.set(storageKey, value)
  }
  listeners.forEach((l) => l())
}

/** 저장 원문 → 문자열 배열. JSON 이 아니거나 문자열 배열이 아니면(깨진 값) null — 기본 열로 넘어간다. 키 검증은 parseColumns 몫. */
function parseStoredRaw(raw: string | null): string[] | null {
  if (raw === null) return null
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null
  } catch {
    return null
  }
}

/** 원문(URL CSV·저장값)에 커스텀 필드 키가 있는가 — 있을 때만 필드 정의를 불러온다(대부분의 사람은 커스텀 열을 쓰지 않는다). */
function mentionsCustomField(raw: string | readonly string[] | null): boolean {
  return parseColumns(raw, null)?.some(isCustomColumnKey) ?? false
}

export interface IssueListColumnsState {
  /** 실제로 그릴 열(표시 순서) — 완료일 필터의 자동 열 포함. */
  columns: IssueListColumnKey[]
  /** 완료일 열이 사용자가 고른 것이 아니라 완료일 필터 때문에 더해졌는가 — 열 메뉴가 「필터로 켜짐」으로 보인다. */
  autoClosed: boolean
  /** 사용자가 고른 열(표시 순서) — 자동 완료일 열 제외. 열 메뉴 토글·저장된 뷰 `cols` 의 기준. */
  chosen: IssueListColumnKey[]
  /** 열을 바꾼다 — URL 에 cols 가 있으면 URL 을(공유·저장된 뷰로 연 화면), 없으면 개인 저장값을 바꾼다. */
  setChosen: (keys: IssueListColumnKey[]) => void
  /** 기본 열로 — URL 에 cols 가 있으면 URL cols 를 기본 열로(개인 저장값은 그대로), 없으면 개인 저장값을 지운다. */
  reset: () => void
}

/**
 * 이슈 목록 선택 열 — URL `cols` → 개인 저장값(사용자·워크스페이스·프로젝트별 localStorage) → 기본.
 * 저장값도 URL 과 같은 규칙(parseColumns)으로 검증해 모르는 키·삭제된 커스텀 필드 키를 버린다.
 * 커스텀 필드 정의는 URL·저장값에 `cf` 키가 있을 때만 요청한다 — 정의가 오기 전엔 형식만 맞으면 유지(깜빡임 방지).
 * 열 메뉴는 열릴 때 같은 쿼리 키로 정의를 직접 불러오므로(IssueColumnPicker) 캐시를 함께 쓴다.
 */
export function useIssueListColumns(projectKey: string, closedFilterActive: boolean): IssueListColumnsState {
  const { user, activeTenant } = useAuth()
  // 로그인 전엔 저장 키가 없다 — 누구의 설정도 읽거나 쓰지 않는다.
  const storageKey = user
    ? userScopedKey(`${STORAGE_BASE}:${projectKey}`, { userId: user.id, tenantId: activeTenant?.tenantId ?? null })
    : null
  const raw = useSyncExternalStore(
    subscribe,
    () => (storageKey ? readRaw(storageKey) : null),
    () => null,
  )
  const [params, setParams] = useSearchParams()
  const urlRaw = params.get(COLS_PARAM)
  const storedList = useMemo(() => parseStoredRaw(raw), [raw])

  const fields = useCustomFields(projectKey, {
    enabled: mentionsCustomField(urlRaw) || mentionsCustomField(storedList),
  })

  const { columns, autoClosed, chosen, order } = useMemo(() => {
    // 정의 순서(position) 의 id — 커스텀 열 정렬 기준이자 삭제된 필드 판정 기준. 로딩 전엔 null(형식만 검사).
    const ids = fields.data ? [...fields.data].sort((a, b) => a.position - b.position).map((d) => d.id) : null
    const url = parseColumns(urlRaw, ids)
    // 저장값만의 보정 — 원문엔 키가 있었는데 하나도 살아남지 못했으면(예: ["cf12"] 인데 필드 12 가 삭제됨)
    // 사용자가 모두 끈 것이 아니라 깨진 값이므로 저장값 없음으로 보고 기본 열로 돌아간다.
    // 원문이 정말 빈 배열이면("모두 끔") 존중하고, URL cols 는 이 보정을 받지 않는다(공유 링크의 `cols=` 는 모두 끔).
    // 「원문이 비었다」 판정은 예전 CSV 비교(`join(',') === ''`)를 그대로 둔다 — [""] 같은 값도 전과 같이 「모두 끔」.
    const parsedStored = parseColumns(storedList, ids)
    const stored = parsedStored?.length === 0 && storedList?.join(',') !== '' ? null : parsedStored
    const fieldOrder = ids ?? []
    const resolved = resolveColumns({ url, stored, closedFilterActive, customFieldOrder: fieldOrder })
    return { columns: resolved.keys, autoClosed: resolved.autoClosed, chosen: resolved.chosen, order: fieldOrder }
  }, [fields.data, urlRaw, storedList, closedFilterActive])

  // 열 구성 쓰기 한 곳 — keys 가 null 이면 「기본 열로」. 쓰는 곳은 URL 에 cols 가 있느냐로 갈린다:
  // - 있으면(공유 링크·열을 담은 저장 뷰로 연 화면) 그 화면의 URL 열만 바꾸고 개인 설정은 건드리지 않는다. 되돌리기도 URL cols 를
  //   지우지 않고 기본 열로 쓴다(스펙 4.7) — 지우면 개인 열이 보여 「기본」이 아니고, 열을 담은 뷰는 기본 열로 바꾼 것이 「수정됨」으로 잡혀야 한다.
  // - 없으면 개인 저장값을 바꾸고, 되돌리기는 저장값을 지운다.
  // URL 쓰기는 savedViewQuery 의 syncSavedViewColumns(저장 뷰 쿼리 문자열 기준)와 입력이 달라 여기서 직접 한다.
  const hasUrlCols = urlRaw !== null
  const commit = useCallback(
    (keys: IssueListColumnKey[] | null) => {
      const next = keys ? orderColumns(keys, order) : null
      if (hasUrlCols) {
        setParams(
          (prev) => {
            const p = new URLSearchParams(prev)
            p.set(COLS_PARAM, serializeColumns(next ?? DEFAULT_COLUMNS))
            return p
          },
          { replace: true },
        )
      } else if (storageKey) {
        writeRaw(storageKey, next ? JSON.stringify(next) : null)
      }
    },
    [hasUrlCols, order, setParams, storageKey],
  )
  const setChosen = useCallback((keys: IssueListColumnKey[]) => commit(keys), [commit])
  const reset = useCallback(() => commit(null), [commit])

  return { columns, autoClosed, chosen, setChosen, reset }
}
