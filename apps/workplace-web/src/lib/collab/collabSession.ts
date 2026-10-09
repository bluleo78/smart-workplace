import { HocuspocusProvider } from '@hocuspocus/provider'
import {
  CLOSE_DELETED,
  CLOSE_FORBIDDEN,
  CLOSE_TOKEN_EXPIRED,
  COLLAB_NS_STORAGE_KEY,
  COLLAB_SCHEMA_MISMATCH,
  COLLAB_SCHEMA_PARAM,
  COLLAB_USER_FIELD,
  collabDocName,
  parseCollabUser,
  WIKI_SCHEMA_VERSION,
} from '@smart-workplace/wiki-editor-schema/collab-protocol'
import * as Y from 'yjs'

import { getAccessToken, refreshAccessTokenOutcome } from '../../api/client'
import { backoffDelay } from '../backoff'
import { mobileWidthStore } from '../mobile/mediaQueryStore'
import {
  advancedClients,
  AWAY_TOAST_MS,
  BACKGROUND_DISCONNECT_MS,
  type CollabResume,
  countAwayEditors,
  type StateVector,
} from './collabResume'
import { type CollabTerminal, isEditRole, parseRoleMessage } from './collabStatus'

/**
 * 노트별 동기화 세션(Y.Doc + provider) 캐시.
 *
 * 화면 폭이 lg 경계를 넘으면 데스크톱↔모바일 셸이 바뀌며 에디터가 재마운트된다(WP-162). 그때마다 새 문서·연결을
 * 만들면 오프라인 중 아직 못 보낸 입력이 사라지므로, 해제 후 잠깐(GRACE_MS) 살려 두었다가 다시 잡으면 재사용한다.
 * 못 보낸 입력이 남아 있으면 유예도 세지 않고 서버가 다 받을 때까지 붙잡는다 — 다른 노트로 이동해도 탭이 열려 있는 한
 * 입력을 잃지 않는다(오프라인 보관은 메모리만, IndexedDB 없음 — 설계 §7.3).
 *
 * 연결 사실(연결 여부·끊긴 시각·미전송·서버가 알린 권한·접근 거부)도 세션이 들고 있다. 재마운트 직전에 받은
 * 역할 변경·4403 을 훅 상태에 두면 재마운트와 함께 사라지기 때문이다. 훅은 구독해서 읽기만 한다.
 */

/** 세션이 모은 연결 사실 — 상태 칩 판정(deriveSyncStatus)의 입력. 바뀔 때마다 새 객체(스냅샷)로 교체된다. */
export interface CollabSessionState {
  /** 인증과 첫 동기화가 끝나 실시간으로 주고받는 중. */
  connected: boolean
  /** 끊긴(또는 아직 못 붙은) 시각(ms). 연결 중이면 null. */
  disconnectedSince: number | null
  /** 한 번이라도 인증·동기화를 마쳤다(이후 끊겨도 true) — 그 전엔 문서가 비어 있어 화면이 본문 대신 skeleton 을 보인다. */
  everSynced: boolean
  /** 내가 입력했는데 서버가 아직 확인하지 않은 변경이 있다. */
  unsynced: boolean
  /** 서버가 알려 준 읽기 전용 여부(인증 scope·역할 변경 알림). 아직 모르면 null. */
  serverReadOnly: boolean | null
  /** 재연결하지 않는 종단 상태(권한 없음 / 삭제 / 로그인 상실 / 스키마 판 불일치). 아니면 null. 종류는 CollabTerminal 참조. */
  terminal: CollabTerminal | null
  /** 돌아와(보이기 복귀) 동기화를 마친 마지막 결과 — 화면이 토스트·하이라이트를 띄운다(WP-293). 아직 없으면 null. */
  resume: CollabResume | null
}

export interface CollabSession {
  /** 노트 id — 정리된 세션을 다시 잡으려 할 때 같은 페이지의 새 세션을 여는 데 쓴다. */
  pageId: number
  doc: Y.Doc
  provider: HocuspocusProvider
  docName: string
  /** 현재 상태 스냅샷 — 바뀌지 않았으면 같은 객체(useSyncExternalStore 용). */
  getState(): CollabSessionState
  /** 상태 변경 구독. 반환 함수로 해지한다. */
  subscribe(listener: () => void): () => void
}

/** 아무도 쓰지 않는 세션을 살려 두는 시간 — 셸 전환 재마운트를 덮을 만큼만. */
const GRACE_MS = 5000
/** 인증이 일시적 이유(불러오기 실패 등)로 거절됐을 때 다시 붙기까지의 첫 간격 — 연달아 실패하면 두 배씩 늘린다. */
const AUTH_RETRY_MS = 3000
/** 연속 인증 실패 재시도 간격 상한 — 장애가 길어져도 API·동기화 서버를 3초마다 두드리지 않게. */
const AUTH_RETRY_MAX_MS = 60_000

/**
 * 마지막으로 보낸 토큰의 출처 — 'forbidden' 거절이 진짜 권한 없음인지 낡은 토큰 탓인지 가르는 데 쓴다.
 * 'refresh-failed' 는 갱신의 일시 실패(네트워크·5xx), 'refresh-rejected' 는 서버가 refresh 쿠키를 거절(로그인 상실).
 */
type TokenSource = 'fresh' | 'stale' | 'refresh-failed' | 'refresh-rejected'

interface Entry {
  pageId: number
  session: CollabSession
  /** 이 세션을 쓰는 화면 수. 0 이 되면 유예 후(미전송 없을 때) 정리한다. */
  holders: number
  /** 유예 정리 타이머. */
  timer: ReturnType<typeof setTimeout> | null
  /** 인증 재시도 타이머. */
  retryTimer: ReturnType<typeof setTimeout> | null
  /** 인증 성공 이후 연속 인증 실패 수 — 재시도 간격(지수 증가)을 정한다. 인증되면 0. */
  authFailures: number
  state: CollabSessionState
  listeners: Set<() => void>
  /** 다음 재접속 때 토큰을 갱신해야 함(4401·token-expired·낡은 토큰의 forbidden 이후). */
  needsRefresh: boolean
  /** 마지막 인증에 보낸 토큰의 출처. */
  lastToken: TokenSource
  /** 마지막으로 서버가 다 받은 뒤 내 입력이 있었는지 — 핸드셰이크만으로 생긴 대기 수를 미전송으로 오인하지 않게 한다. */
  dirty: boolean
  destroyed: boolean
  /**
   * 연결 중 본 clientID → userId(awareness user). 지우지 않고 누적한다 — 소켓이 닫히면 HocuspocusProvider.onClose 가 나를 뺀
   * 원격 awareness 상태를 모두 지우므로(origin = provider), 그 뒤에도 "누가 고쳤나" 를 셀 수 있게.
   */
  knownUsers: Map<number, number>
  /** 숨겨진 시각(ms). 보이는 중이면 null. */
  hiddenAt: number | null
  /**
   * 숨길 때의 state vector — 돌아와 동기화된 뒤와 비교해 그사이 고친 클라이언트를 찾는다.
   * 첫 동기화 전엔 잡지 않는다(null) — 빈 문서와 비교하면 서버의 기존 이력 전체가 "자리 비운 동안의 편집" 으로 세진다.
   * 숨겨진 채 첫 동기화가 끝나면 그때 잡는다.
   */
  svAtHide: StateVector | null
  /**
   * 기준을 잡은 뒤 원격 편집이 무언가를 지웠다 — 지우기만 한 편집은 지운 쪽 clientID 의 clock 을 늘리지 않아(Yjs delete set 은
   * 지운 사람이 아니라 지워진 항목의 작성자로 기록) state vector 차이로는 안 보인다. 그래서 원격 update 의 delete set 을 따로 본다.
   */
  awayDeletes: boolean
  /** 로그인 사용자 id(화면이 넘긴다) — 내 다른 탭을 빼는 기준. awareness 에 내 상태가 아직 없어도 맞게 뺀다. */
  selfUserId: number | null
  /** restartConnection 이 소켓 닫힘(status)을 기다리는 구독 해지 — 의도한 해제·종단이 그 재연결을 되살리지 않게 끊는다. */
  cancelRestartWait: (() => void) | null
  /** 백그라운드 자가 해제 타이머(모바일). */
  bgTimer: ReturnType<typeof setTimeout> | null
  /** 해제 시점에 못 보낸 입력이 있었다 — 다 보내지면(숨겨진 채라면) 그때 끊는다. */
  disconnectWhenSent: boolean
  /** 백그라운드 자가 해제로 끊었다 — 돌아올 때 끊긴 시각을 새로 잡는 건 이 경우뿐이다(평소 끊김의 '오프라인' 은 그대로 둔다). */
  selfDisconnected: boolean
  /**
   * 백그라운드 자가 해제를 유지하는 중 — 숨겨진 동안 다시 붙기 시작하면(status connecting·connected) 다시 끊는다.
   * provider 는 소켓이 닫힐 때(무응답 검사 등) 재연결을 타이머로 예약하는데, 뒤이은 disconnect() 가 그 타이머를 취소하지 못해
   * 타이머가 돌면 숨겨진 채 다시 붙는다(WP-293 Task 9 에서 발견). 돌아옴·종단·정리 때 내린다.
   */
  holdOffline: boolean
  /** 돌아왔고 동기화를 기다리는 중 — synced 때 resume 을 낸다. */
  pendingResume: { awayMs: number; sv: StateVector } | null
  resumeSeq: number
  /** 문서·창 이벤트(visibilitychange·online) 해제. */
  detachLifecycle: () => void
}

/** 종단으로 닫는 종료 코드 → 종단 상태, 우선순위 순(삭제가 권한 회수보다 먼저). */
const CLOSE_TERMINAL: readonly (readonly [{ code: number; reason: string }, CollabTerminal])[] = [
  [CLOSE_DELETED, 'deleted'],
  [CLOSE_FORBIDDEN, 'forbidden'],
]

/** 페이지별 현재 세션(재사용 대상). 종단 세션은 여기서 빠진다. */
const current = new Map<number, Entry>()
/** 살아 있는 모든 세션 — 캐시에서 빠졌지만 아직 화면이 쥔 종단 세션 포함. */
const entries = new Map<CollabSession, Entry>()

/**
 * 토큰 갱신 단일화 — 모든 세션이 같은 JWT 를 쓰므로 만료(4401)도 동시에 맞는다. 세션마다 따로 갱신하면 refresh 토큰을
 * 회전하는 서버에서 두 번째 호출이 실패해 로그아웃(setAccessToken(null))될 수 있어, 진행 중인 갱신을 함께 기다린다.
 */
let refreshing: Promise<'ok' | 'rejected' | 'error'> | null = null
function refreshOnce(): Promise<'ok' | 'rejected' | 'error'> {
  refreshing ??= refreshAccessTokenOutcome().finally(() => {
    refreshing = null
  })
  return refreshing
}

/** 문서 이름 — E2E 빌드는 테스트마다 네임스페이스를 붙여 병렬 테스트끼리 문서가 섞이지 않게 한다(규약은 collab-protocol). */
function docNameFor(pageId: number): string {
  const ns = __E2E__ ? (globalThis.localStorage?.getItem(COLLAB_NS_STORAGE_KEY) ?? '') : ''
  return collabDocName(ns, pageId)
}

/**
 * 동기화 서버 주소 — 같은 출처의 /collab(개발은 vite 프록시, 운영은 nginx 가 넘긴다).
 * 이 탭이 빌드된 스키마 판을 쿼리로 싣는다(WP-313) — 서버는 판이 다르면 문서를 주기 전에 거부한다.
 * Hocuspocus 4 provider 엔 접속 파라미터 옵션이 없어 URL 쿼리로 보낸다(토큰에 섞으면 API 인증 토큰 규약이 흐려진다).
 */
function collabUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab?${COLLAB_SCHEMA_PARAM}=${WIKI_SCHEMA_VERSION}`
}

/**
 * 서버가 다 받기 전에 놓으면 안 되는 입력이 있는지 — 읽기 전용·권한 없음(forbidden)·삭제(deleted) 세션의 입력은 영원히 확인되지 않으므로 제외.
 * 로그인 상실(authLost)은 포함한다 — 다시 로그인하러 떠날 때(axios 인터셉터의 /login 이동·안내의 "다시 로그인") 탭 이탈 경고로
 * 미전송 입력이 있음을 알려야 한다. 보유자가 없는 종단 세션의 정리는 onStateChanged 가 isTerminal 로 먼저 판단한다.
 */
function isPending(entry: Entry): boolean {
  const { unsynced, serverReadOnly, terminal } = entry.state
  // 스키마 판이 달라진 세션(schemaStale)도 입력이 영원히 확인되지 않는다 — 새로고침 안내가 그 사실을 함께 알린다.
  // 삭제(deleted)는 보낼 문서가 없어 탭 이탈 경고 대상이 아니다.
  return unsynced && serverReadOnly !== true && (terminal === null || terminal === 'authLost')
}

/** 재연결하지 않는 종단 상태(권한 없음, 삭제, 로그인 상실, 스키마 판 불일치). */
function isTerminal(entry: Entry): boolean {
  return entry.state.terminal !== null
}

/** 이 탭이 지금 숨겨져 있는지 — 테스트(jsdom)·E2E 가 document.visibilityState 를 덮어 바꾼다. */
function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * awareness 의 user 로 clientID → userId 를 모은다(지우지 않음). 커서 이동마다 불리므로 들어오거나 바뀐 접속자만 본다 —
 * 변경 목록이 없으면(호출자가 안 넘김) 전체를 본다.
 */
function rememberUsers(entry: Entry, changes?: { added: number[]; updated: number[] }): void {
  const aw = entry.session.provider.awareness
  if (!aw) return
  const states = aw.getStates()
  for (const id of changes ? [...changes.added, ...changes.updated] : states.keys()) {
    const u = parseCollabUser((states.get(id) as Record<string, unknown> | undefined)?.[COLLAB_USER_FIELD])
    if (u) entry.knownUsers.set(id, u.id)
  }
}

/** 자리 비움 기준을 지금 문서로 잡는다 — 첫 동기화 전이면 잡지 않는다(svAtHide 주석). */
function armAwayBaseline(entry: Entry): void {
  if (!entry.state.everSynced) return
  entry.svAtHide = stateVectorOf(entry)
  entry.awayDeletes = false
}

/** 지금 문서의 state vector. */
function stateVectorOf(entry: Entry): StateVector {
  return Y.decodeStateVector(Y.encodeStateVector(entry.session.doc))
}

/**
 * 숨겨짐(탭 전환·화면 잠금·다른 앱) — 시각과 state vector 를 적어 두고, 모바일 셸이면 2분 뒤 스스로 끊는다(스펙 §7.2 배터리·데이터).
 * 데스크톱은 끊지 않는다(백그라운드 탭이어도 같은 노트의 접속자로 남는다).
 */
function onHidden(entry: Entry): void {
  if (entry.destroyed || isTerminal(entry) || entry.hiddenAt !== null) return
  const carried = entry.pendingResume
  entry.pendingResume = null
  if (carried) {
    // 돌아와 따라잡기 전에 다시 숨겨졌다 — 숨겨진 동안엔 resume 을 내지 않고, 앞의 기준·비운 시간을 이어 받는다(그사이 편집을 놓치지 않게).
    entry.hiddenAt = Date.now() - carried.awayMs
    entry.svAtHide = carried.sv
  } else {
    entry.hiddenAt = Date.now()
    armAwayBaseline(entry)
  }
  if (mobileWidthStore.get()) {
    entry.bgTimer = setTimeout(() => {
      entry.bgTimer = null
      backgroundDisconnect(entry)
    }, BACKGROUND_DISCONNECT_MS)
  }
}

/** 백그라운드 자가 해제 — 못 보낸 입력이 있으면 다 보낸 뒤로 미룬다(OS 가 앱을 죽이면 사라지므로). */
function backgroundDisconnect(entry: Entry): void {
  if (entry.destroyed || isTerminal(entry) || !isPageHidden()) return
  if (isPending(entry)) {
    entry.disconnectWhenSent = true
    return
  }
  entry.disconnectWhenSent = false
  cancelRestart(entry)
  // 이미 실제로 끊겨 있었으면(보이는 동안의 네트워크 끊김) 돌아와도 그 '오프라인' 을 그대로 보인다 — 내가 끊은 연결만 표시한다.
  entry.selfDisconnected = entry.state.connected
  entry.holdOffline = true
  entry.session.provider.disconnect()
}

/** 지금 바로 다시 붙는다 — provider 의 지수 백오프 대기를 건너뛴다(connect 가 대기 중인 재시도를 취소). 인증 재시도 대기는 그 흐름에 맡긴다. */
function reconnectNow(entry: Entry): void {
  if (entry.destroyed || isTerminal(entry) || entry.retryTimer) return
  if (entry.session.provider.configuration.websocketProvider?.status === 'connected') return
  void entry.session.provider.connect()
}

/**
 * 다시 보임 — 해제 타이머를 끄고 곧바로 다시 붙는다(스펙 §7.2 "복귀 즉시 재접속·동기화").
 * - 모바일 셸에서 오래(2분 초과) 비웠는데 소켓이 살아 보이면(OS 가 타이머를 재워 자가 해제가 못 돈 경우) 얼었던 소켓일 수 있어
 *   끊었다 다시 붙는다(새 핸드셰이크로 확실히 따라잡음). 데스크톱 백그라운드 탭은 소켓이 실제로 살아 있으므로 다시 붙지 않는다 —
 *   다시 붙으면 '재연결 중' 이 깜빡이고 다른 사람 화면에서 내가 나갔다 들어온다.
 * - 살아 있고 동기화된 연결이면 그사이 변경은 이미 들어와 있으니 바로 resume 을 낸다.
 * - 그 밖엔 붙고, synced 때 resume 을 낸다.
 */
function onVisible(entry: Entry): void {
  if (entry.bgTimer) clearTimeout(entry.bgTimer)
  entry.bgTimer = null
  entry.disconnectWhenSent = false
  const { hiddenAt, svAtHide, selfDisconnected, holdOffline } = entry
  entry.selfDisconnected = false
  entry.holdOffline = false
  entry.hiddenAt = null
  entry.svAtHide = null
  if (hiddenAt === null || entry.destroyed || isTerminal(entry)) return
  if (svAtHide === null) {
    // 첫 동기화 전에 숨겨져 기준이 없다 — 비운 동안의 편집을 셀 수 없어 resume 은 내지 않는다. 그래도 숨겨진 동안 스스로 끊었으면
    // 다시 붙어야 한다(disconnect() 가 provider 의 자동 재연결을 껐다). 끊지 않았으면 진행 중인 첫 연결을 그대로 둔다 —
    // 연결 중에 connect() 하면 provider 가 소켓을 닫고 다시 연다.
    if (!holdOffline) return
    // 한 번도 붙지 못한 채 스스로 끊었으면 state.connected 가 처음부터 false 라 selfDisconnected 도 false 다 — 그래도
    // 다시 붙기 시작하는 지금부터 끊김을 세야 칩이 곧바로 '오프라인' 이 아닌 '재연결 중' 으로 보인다.
    if (!entry.state.connected) patch(entry, { disconnectedSince: Date.now() })
    reconnectNow(entry)
    return
  }
  const awayMs = Date.now() - hiddenAt
  entry.pendingResume = { awayMs, sv: svAtHide }
  const { provider } = entry.session
  const open = provider.configuration.websocketProvider?.status === 'connected'
  if (open && awayMs > AWAY_TOAST_MS && mobileWidthStore.get()) {
    restartConnection(entry, 0)
    return
  }
  if (open && provider.isSynced) {
    finishResume(entry)
    return
  }
  // 스스로 끊었다 돌아왔다 — 다시 붙기 시작하는 지금부터 끊김을 센다. 숨겨진 동안의 끊김까지 세면 붙는 중인데도 칩이
  // 곧바로 '오프라인' 으로 보인다(의도한 해제는 평소 재연결과 같은 '재연결 중' 으로 보여야 한다). 정말 네트워크가 없으면
  // 5초 뒤 그대로 '오프라인' 이 된다. 보이는 동안 생긴 실제 끊김은 손대지 않는다 — 탭을 오가도 정직한 '오프라인' 이 유지된다.
  if (selfDisconnected && !entry.state.connected) patch(entry, { disconnectedSince: Date.now() })
  reconnectNow(entry)
}

/**
 * 돌아와 동기화를 마쳤다 — 숨길 때와 지금의 state vector 차이로 그사이 고친 사람 수를 세어 상태로 낸다.
 * 알려진 한계(고치지 않음, 계획 판정 14):
 * - 서버 쪽 적용(AI 적용·문서 정합 reconcile)은 서버 Y.Doc 의 clientID 로 들어온다. 그 clientID 는 서버가 문서를 다시 불러올 때마다
 *   바뀌므로, 비운 사이 서버 재적재가 끼면 같은 AI 라도 적재마다 한 명씩 세진다. 사람의 편집 없이 서버 reconcile 만 있어도 한 명으로 센다.
 * - 첫 동기화 뒤 아직 awareness 가 안 온 새 접속자는 clientID(탭)마다 한 명으로 센다.
 */
function finishResume(entry: Entry): void {
  const r = entry.pendingResume
  if (!r) return
  entry.pendingResume = null
  const { clientID } = entry.session.doc
  const counted = countAwayEditors(advancedClients(r.sv, stateVectorOf(entry)), entry.knownUsers, {
    clientId: clientID,
    userId: entry.selfUserId ?? entry.knownUsers.get(clientID) ?? null,
  })
  // 지우기만 한 원격 편집은 clock 이 늘지 않아 위에서 안 보인다 — 누가 지웠는지는 몰라도 적어도 한 명이다.
  const editors = counted === 0 && entry.awayDeletes ? 1 : counted
  entry.awayDeletes = false
  entry.resumeSeq += 1
  patch(entry, { resume: { seq: entry.resumeSeq, awayMs: r.awayMs, editors } })
}

/** 문서·창 이벤트 연결 — 세션마다(페이지별) 단다. 해제 함수를 돌려준다. */
function attachLifecycle(entry: Entry): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const onVisibility = () => (isPageHidden() ? onHidden(entry) : onVisible(entry))
  // 네트워크가 돌아오면 백오프를 기다리지 않고 바로 붙는다 — 숨겨진 동안은 돌아올 때(onVisible) 붙는다.
  const onOnline = () => {
    if (!isPageHidden()) reconnectNow(entry)
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
  }
}

/**
 * 상태 일부를 바꾸고, 실제로 바뀌었을 때만 새 스냅샷을 만들어 알린다.
 * 입력마다(syncUnsynced) 불리는 경로라 바뀐 키가 없으면 새 객체를 만들지 않는다.
 */
function patch(entry: Entry, next: Partial<CollabSessionState>): void {
  if (entry.destroyed) return
  const keys = Object.keys(next) as (keyof CollabSessionState)[]
  if (keys.every((k) => next[k] === entry.state[k])) return
  entry.state = { ...entry.state, ...next }
  entry.listeners.forEach((fn) => fn())
  onStateChanged(entry)
}

function markDisconnected(entry: Entry): void {
  patch(entry, { connected: false, disconnectedSince: entry.state.disconnectedSince ?? Date.now() })
}

function markConnectedIfReady(entry: Entry): void {
  const { provider } = entry.session
  if (provider.isAuthenticated && provider.isSynced) {
    patch(entry, { connected: true, everSynced: true, disconnectedSince: null })
  }
}

function syncUnsynced(entry: Entry): void {
  patch(entry, { unsynced: entry.dirty && entry.session.provider.hasUnsyncedChanges })
  // 백그라운드 해제를 미뤄 둔 채 입력이 다 전송됐으면 이제 끊는다.
  if (entry.disconnectWhenSent && !entry.state.unsynced) backgroundDisconnect(entry)
}

/**
 * 종단 상태로 멈춘다 — 재시도 타이머를 끄고, 동기로 끊어 provider 의 자동 재연결을 막고, 캐시에서 뺀다(다시 열면 새 세션으로 처음부터 판정).
 * disconnect() 는 동기로 불러야 provider 가 소켓 종료 처리 중 예약하는 자동 재연결을 막는다.
 * - forbidden: 권한 없음, 또는 삭제 여부를 모르는 거절.
 * - deleted: 페이지 삭제(4404) — 다시 붙을 문서가 없다.
 * - authLost: 로그인 상실(refresh 쿠키 거절) — 다시 로그인하기 전엔 어떤 토큰으로도 붙을 수 없다. 계속 재시도하면 /auth/refresh 와
 *   collab-access 를 끝없이 두드린다. 앱의 다른 곳(axios 인터셉터·SSE)도 refresh 실패 뒤엔 재시도하지 않는다.
 * - schemaStale: 동기화 서버의 스키마 판이 다름(WP-313) — 새로고침해 새 에디터를 받기 전엔 몇 번을 다시 붙어도 거절된다.
 */
function stopTerminal(entry: Entry, terminal: CollabTerminal): void {
  if (entry.state.terminal) return
  cancelRestart(entry)
  if (entry.bgTimer) clearTimeout(entry.bgTimer)
  entry.bgTimer = null
  entry.pendingResume = null
  entry.selfDisconnected = false
  entry.holdOffline = false
  entry.session.provider.disconnect()
  if (current.get(entry.pageId) === entry) current.delete(entry.pageId)
  patch(entry, { terminal })
}

/** 예약된 재연결(타이머·소켓 닫힘 대기)을 모두 취소한다 — 의도한 해제·종단·새 재시작 때. */
function cancelRestart(entry: Entry): void {
  if (entry.retryTimer) clearTimeout(entry.retryTimer)
  entry.retryTimer = null
  entry.cancelRestartWait?.()
  entry.cancelRestartWait = null
}

/**
 * 연결을 끊었다가 잠시 뒤 다시 붙는다 — 일시적 인증 거절 재시도, 문서 단위 종료(CLOSE 메시지·코드 1000 — provider 가 스스로 다시 붙지 않는다), 오래 비운 뒤 복귀(얼었던 소켓) 때 쓴다.
 * provider 는 인증 실패 뒤 스스로 재시도하지 않는다.
 */
function restartConnection(entry: Entry, delayMs = AUTH_RETRY_MS): void {
  cancelRestart(entry)
  const { provider } = entry.session
  provider.disconnect()
  const reconnect = () => {
    if (!entry.destroyed && !isTerminal(entry)) void provider.connect()
  }
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null
    // disconnect() 의 소켓 닫힘은 비동기다. 아직 닫히는 중(connected)에 connect() 하면 provider 가 "이미 연결됨"으로
    // 무시하고, 닫힌 뒤엔 disconnect() 가 끈 자동 재연결도 없어 영영 다시 붙지 않는다 — 닫힌 다음에 붙는다.
    const ws = provider.configuration.websocketProvider
    if (ws?.status !== 'connected') {
      reconnect()
      return
    }
    const onStatus = ({ status }: { status: string }) => {
      if (status !== 'disconnected') return
      ws.off('status', onStatus)
      entry.cancelRestartWait = null
      reconnect()
    }
    ws.on('status', onStatus)
    entry.cancelRestartWait = () => ws.off('status', onStatus)
  }, delayMs)
}

/**
 * 인증 거절 처리.
 * - schema-mismatch: 동기화 서버의 스키마 판이 이 탭과 다름(배포) → 종단(새로고침 안내).
 * - invalid-document: 문서 이름 자체가 틀림 → 종단.
 * - forbidden: 갓 갱신한 토큰으로도 거절됐을 때만 종단. API 는 만료 토큰도 401 → 'forbidden' 으로 돌려주므로,
 *   토큰 수명보다 긴 오프라인 뒤 재접속(4401 을 못 받은 경우)을 '삭제·권한 없음'으로 오판하면 미전송 입력까지 버리게 된다.
 *   낡은 토큰이었으면 갱신해 곧바로 다시 붙는다.
 * - 갱신이 거절됐으면(refresh 4xx — 로그아웃·만료) 무엇으로 거절됐든 로그인 상실 종단. 갱신의 일시 실패(네트워크·5xx)는
 *   권한 판정이 아니므로 종단으로 두지 않는다.
 * - token-expired·그 밖(불러오기 실패·갱신 일시 실패 등): 일시적 → 갱신 표시 후 간격을 두고 재시도. 간격은 연속 실패마다 두 배(상한 있음).
 */
function onAuthFailed(entry: Entry, reason: string): void {
  // 스키마 판 불일치는 토큰과 무관한 맨 앞 판정(서버가 인증 전에 거부) — 토큰 출처보다 먼저 본다.
  if (reason === COLLAB_SCHEMA_MISMATCH) {
    stopTerminal(entry, 'schemaStale')
    return
  }
  if (entry.lastToken === 'refresh-rejected') {
    stopTerminal(entry, 'authLost')
    return
  }
  if (reason === 'invalid-document' || (reason === 'forbidden' && entry.lastToken === 'fresh')) {
    stopTerminal(entry, 'forbidden')
    return
  }
  if (reason === 'forbidden' || reason === 'token-expired') entry.needsRefresh = true
  if (reason === 'forbidden' && entry.lastToken === 'stale') {
    // 낡은 토큰 탓 — 갱신해 곧바로 다시 붙는다(실패로 세지 않는다).
    restartConnection(entry, 0)
    return
  }
  entry.authFailures += 1
  restartConnection(entry, authRetryDelay(entry.authFailures))
}

/** n 번째 연속 인증 실패 뒤 재시도 간격 — 3s, 6s, 12s … 상한 AUTH_RETRY_MAX_MS. */
function authRetryDelay(failures: number): number {
  return backoffDelay(AUTH_RETRY_MS, AUTH_RETRY_MAX_MS, failures)
}

/** 아무도 안 쓰는 세션의 정리 시점 판단 — 상태가 바뀔 때마다, 그리고 마지막 보유자가 놓을 때 부른다. */
function onStateChanged(entry: Entry): void {
  updateBeforeUnload()
  if (entry.holders > 0 || entry.destroyed) return
  if (isTerminal(entry)) {
    destroyEntry(entry)
    return
  }
  if (isPending(entry)) {
    // 못 보낸 입력이 생기면 유예를 멈추고 서버가 받을 때까지 붙잡는다(R15).
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    return
  }
  if (!entry.timer) entry.timer = setTimeout(() => destroyEntry(entry), GRACE_MS)
}

function destroyEntry(entry: Entry): void {
  if (entry.destroyed) return
  if (entry.timer) clearTimeout(entry.timer)
  if (entry.bgTimer) clearTimeout(entry.bgTimer)
  cancelRestart(entry)
  entry.timer = entry.bgTimer = null
  entry.holdOffline = false
  entry.destroyed = true
  entry.detachLifecycle()
  entry.listeners.clear()
  entries.delete(entry.session)
  if (current.get(entry.pageId) === entry) current.delete(entry.pageId)
  entry.session.provider.destroy()
  entry.session.doc.destroy()
  updateBeforeUnload()
}

/** 새 세션 생성 — provider 이벤트를 상태로 옮기는 배선까지 한다. */
function createEntry(pageId: number): Entry {
  const doc = new Y.Doc()
  const docName = docNameFor(pageId)
  // entry 는 아래에서 채운다 — token 콜백과 이벤트 핸들러가 같은 entry 를 참조해야 한다.
  // eslint-disable-next-line prefer-const
  let entry: Entry
  const provider = new HocuspocusProvider({
    url: collabUrl(),
    name: docName,
    document: doc,
    // 재접속마다 호출된다. 만료(4401)로 끊겼거나 메모리에 토큰이 없으면 갱신 후 보낸다 — 만료 토큰은 여전히
    // 메모리에 남아 있어(null 이 아님) 그냥 꺼내 쓰면 같은 거절이 반복된다. provider 가 이 Promise 를 기다리므로 경합이 없다.
    token: async () => {
      if (entry.needsRefresh || !getAccessToken()) {
        entry.needsRefresh = false
        const outcome = await refreshOnce()
        entry.lastToken = outcome === 'ok' ? 'fresh' : outcome === 'rejected' ? 'refresh-rejected' : 'refresh-failed'
      } else {
        entry.lastToken = 'stale'
      }
      return getAccessToken() ?? ''
    },
  })
  const session: CollabSession = {
    pageId,
    doc,
    provider,
    docName,
    getState: () => entry.state,
    subscribe: (listener) => {
      entry.listeners.add(listener)
      return () => entry.listeners.delete(listener)
    },
  }
  entry = {
    pageId,
    session,
    holders: 0,
    timer: null,
    retryTimer: null,
    authFailures: 0,
    state: {
      connected: false,
      everSynced: false,
      disconnectedSince: Date.now(),
      unsynced: false,
      serverReadOnly: null,
      terminal: null,
      resume: null,
    },
    listeners: new Set(),
    needsRefresh: false,
    lastToken: 'stale',
    dirty: false,
    destroyed: false,
    knownUsers: new Map(),
    hiddenAt: null,
    svAtHide: null,
    bgTimer: null,
    disconnectWhenSent: false,
    selfDisconnected: false,
    holdOffline: false,
    awayDeletes: false,
    selfUserId: null,
    cancelRestartWait: null,
    pendingResume: null,
    resumeSeq: 0,
    detachLifecycle: () => {},
  }

  // 내 입력(원격 반영은 provider 가 origin) — 서버가 다 받을 때까지 미전송 후보.
  doc.on('update', (_update: Uint8Array, origin: unknown, _doc: Y.Doc, transaction: Y.Transaction) => {
    if (origin === provider) {
      // 자리 비운 동안(기준을 잡은 뒤) 원격 편집이 지웠는지 — 트랜잭션의 delete set 은 그 트랜잭션에서 새로 지운 것만 담는다.
      if (entry.svAtHide !== null || entry.pendingResume !== null) {
        entry.awayDeletes ||= transaction.deleteSet.clients.size > 0
      }
      return
    }
    entry.dirty = true
    syncUnsynced(entry)
  })
  provider.on('unsyncedChanges', ({ number }: { number: number }) => {
    if (number === 0) entry.dirty = false
    syncUnsynced(entry)
  })
  provider.on('status', ({ status }: { status: string }) => {
    if (status !== 'connected') markDisconnected(entry)
    // 자가 해제 중인데 숨겨진 채 다시 붙기 시작했다(provider 가 해제 전에 예약해 둔 재연결) — 다시 끊는다. holdOffline 주석.
    if (entry.holdOffline && status !== 'disconnected' && isPageHidden()) provider.disconnect()
  })
  provider.on('authenticated', ({ scope }: { scope: string }) => {
    entry.authFailures = 0
    patch(entry, { serverReadOnly: scope === 'readonly' })
    markConnectedIfReady(entry)
  })
  provider.on('synced', () => {
    markConnectedIfReady(entry)
    // 숨겨진 채 첫 동기화를 마쳤다 — 이제야 기준을 잡을 수 있다(그 전의 서버 이력은 자리 비운 동안의 편집이 아니다).
    if (entry.hiddenAt !== null && entry.svAtHide === null) armAwayBaseline(entry)
    // 돌아와 다시 붙는 중이었다면 이제 그사이 변경까지 받았다 — 고친 사람 수를 낸다.
    if (entry.pendingResume) finishResume(entry)
  })
  // 누가 이 노트에 있었는지(clientID → userId) — 돌아와 "N명이 수정" 을 셀 때 쓴다.
  provider.awareness?.on('change', (changes?: { added: number[]; updated: number[] }) => rememberUsers(entry, changes))
  // 소켓 종료 — 4401 은 다음 재접속(provider 자동)에 새 토큰, 4403(권한 회수)·4404(삭제)는 종단.
  provider.on('disconnect', ({ event }: { event: { code: number } }) => {
    markDisconnected(entry)
    if (event.code === CLOSE_TOKEN_EXPIRED.code) entry.needsRefresh = true
    const hit = CLOSE_TERMINAL.find(([c]) => c.code === event.code)
    if (hit) stopTerminal(entry, hit[1])
  })
  // 문서 단위 종료(CLOSE 메시지, 코드 1000)는 소켓이 열린 채 남고 provider 가 다시 붙지 않는다 — 직접 다시 붙인다.
  provider.on('close', ({ event }: { event: { code: number; reason?: string } }) => {
    markDisconnected(entry)
    // 문서 단위 종료는 코드가 1000 이라 사유로도 맞춘다.
    const hit = CLOSE_TERMINAL.find(([c]) => c.code === event.code || c.reason === event.reason)
    if (hit) stopTerminal(entry, hit[1])
    else if (provider.configuration.websocketProvider?.status === 'connected') restartConnection(entry)
  })
  provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
    markDisconnected(entry)
    onAuthFailed(entry, reason)
  })
  // 세션 도중 역할 변경 알림 — Hocuspocus 는 연결 중 권한을 바꾸는 메시지가 없어 서버가 stateless 로 알린다.
  provider.on('stateless', ({ payload }: { payload: string }) => {
    const role = parseRoleMessage(payload)
    if (role !== null) patch(entry, { serverReadOnly: !isEditRole(role) })
  })

  entry.detachLifecycle = attachLifecycle(entry)
  // 이미 숨겨진 탭에서 만들어졌으면(백그라운드 탭 복원 등) 지금부터 숨김으로 센다.
  if (isPageHidden()) onHidden(entry)
  entries.set(session, entry)
  current.set(pageId, entry)
  return entry
}

/**
 * 세션을 얻되 보유자로 등록하지는 않는다 — 렌더 중 세션이 필요할 때(에디터 생성) 쓴다.
 * 새로 만든 세션은 곧 retain 되지 않으면 유예 후 정리된다(StrictMode 이중 렌더로 생긴 세션도 새지 않는다).
 */
export function openCollabSession(pageId: number): CollabSession {
  return openEntry(pageId).session
}

/** 이 세션의 로그인 사용자 id 를 알린다 — 자리 비운 동안 고친 사람을 셀 때 내 다른 탭을 빼는 기준(화면이 로그인 정보로 넘긴다). */
export function setCollabSelfUser(session: CollabSession, userId: number | null): void {
  const entry = entries.get(session)
  if (entry) entry.selfUserId = userId
}

/** 페이지의 현재 세션 항목 — 없으면 만들고 아무도 잡지 않으면 유예 정리를 건다. */
function openEntry(pageId: number): Entry {
  const hit = current.get(pageId)
  if (hit) return hit
  const entry = createEntry(pageId)
  onStateChanged(entry)
  return entry
}

/**
 * 이 세션을 쓰기 시작한다 — 유예 정리를 취소하고, 실제로 보유하게 된 세션을 돌려준다.
 * 넘긴 세션이 이미 정리됐으면(렌더와 보유 사이에 유예가 지났거나, 숨겨졌던 화면이 유예 뒤 다시 보일 때) 같은 페이지의
 * 살아 있는 세션을 대신 잡아 돌려준다 — 죽은 provider 를 쥐고 영영 동기화되지 않는 화면이 생기지 않게. 호출자는 반환값을 써야 한다.
 */
export function retainCollabSession(session: CollabSession): CollabSession {
  const entry = entries.get(session) ?? openEntry(session.pageId)
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = null
  entry.holders += 1
  return entry.session
}

/**
 * 보유 해제 — 보유했던 그 세션을 넘긴다(페이지 번호로 놓으면 4403 뒤 같은 페이지의 새 세션을 대신 놓을 수 있다).
 * 마지막 보유자가 놓으면 유예(GRACE_MS) 후 정리 — 단, 못 보낸 입력이 있으면 서버가 받을 때까지 미룬다.
 */
export function releaseCollabSession(session: CollabSession): void {
  const entry = entries.get(session)
  if (!entry || entry.holders === 0) return
  entry.holders -= 1
  onStateChanged(entry)
}

/** 못 보낸 입력이 남은 세션이 있는지(놓인 세션 포함). */
export function hasUnsentCollabChanges(): boolean {
  for (const entry of entries.values()) if (isPending(entry)) return true
  return false
}

// 탭 닫기·새로고침 경고 — 화면이 떠난 뒤 붙잡아 둔 세션도 대상이라 훅이 아니라 캐시 단위로 건다.
// 리스너가 있으면 일부 브라우저가 bfcache 를 끄므로 미전송이 있는 동안만 붙인다.
function onBeforeUnload(e: BeforeUnloadEvent): void {
  e.preventDefault()
  // 구형 브라우저 호환 — returnValue 를 채워야 확인 창을 띄운다.
  e.returnValue = ''
}
let beforeUnloadAttached = false
function updateBeforeUnload(): void {
  if (typeof window === 'undefined') return
  const want = hasUnsentCollabChanges()
  if (want === beforeUnloadAttached) return
  beforeUnloadAttached = want
  if (want) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
}

/** 테스트 전용 — 모든 세션을 즉시 정리한다. */
export function resetCollabSessionsForTest(): void {
  for (const entry of [...entries.values()]) destroyEntry(entry)
}
