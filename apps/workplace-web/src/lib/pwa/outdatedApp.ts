// src/lib/pwa/outdatedApp.ts
// 옛 버전 앱이 새 화면 주소를 몰라 띄운 404 복구(WP-872).
// 서비스워커는 주소 이동을 precache 된 앱으로 열고, 새 버전은 사용자가 토스트를 눌러야 적용된다(registerType prompt).
// 그래서 배포 뒤 새로 생긴 화면의 링크(북마크·메일·알림)를 옛 앱이 남은 브라우저로 열면, 실제로 있는 화면인데도 `*` 404 가 뜬다.
// → 404 화면이 뜨면 서버 버전(version.json)과 지금 앱 버전을 비교하고, 서버가 새 버전이면 새 SW 를 적용해 같은 주소를 다시 연다.
//   이 창에 저장 안 한 입력(다른 화면에서 남은 노트 동기화 등)이 있으면 적용하지 않는다. 다른 창은 WP-664 규칙(저장 안 한 입력이 있으면 안내만)을 따른다.

import { hasUnsavedInput } from '@/lib/unsavedInput'
import { withTimeout } from '@/lib/withTimeout'

import { applyWaitingUpdate, waitForSwState, type WaitingSw } from './applyUpdate'

/** 업데이트 확인·새 SW 설치(precache 다운로드)를 각각 기다리는 최대 시간 — 넘기면 404 를 보이고, 설치가 끝나면 기존 토스트가 알린다. */
const INSTALL_TIMEOUT_MS = 15_000
/** version.json 을 기다리는 최대 시간 — 네트워크가 멈춰도 로딩 자리 표시에 머물지 않고 404 를 보이게. */
const VERSION_TIMEOUT_MS = 5_000

/** SKIP_WAITING 을 받을 수 있는 ServiceWorker */
type Sw = WaitingSw & { postMessage: (message: unknown) => void }

/** 필요한 부분만 쓴 ServiceWorkerRegistration */
export interface UpdatableRegistration {
  waiting: Sw | null
  installing: Sw | null
  update: () => Promise<unknown>
}

export interface OutdatedAppEnv {
  /** 지금 실행 중인 앱 버전(__APP_VERSION__). */
  currentVersion: string
  /** 404 가 난 주소 — 같은 주소로 되풀이 시도하지 않게 기록하는 키에 쓴다. */
  path: string
  /** 서버에 배포된 버전. 읽지 못하면 null. */
  fetchServerVersion: () => Promise<string | null>
  getRegistration: () => Promise<UpdatableRegistration | undefined>
  /** 적용 기록(sessionStorage) — 새로고침 뒤에도 404 면(새 버전에도 없는 주소) 다시 적용하지 않는다. */
  storage: { get: (key: string) => string | null; set: (key: string, value: string) => void }
  reload: () => void
  /** 이 창에 저장 안 한 입력이 있는지(WP-664) — 있으면 적용하지 않고 토스트로 사용자에게 맡긴다. */
  hasUnsavedInput: () => boolean
  /** 404 화면을 떠나면 중단 — 확인·설치를 기다리는 사이 사용자가 다른 화면으로 옮겼으면 새로고침하지 않는다. */
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * 서버에 새 버전이 있으면 새 SW 를 적용하고 같은 주소를 다시 연다. SW 관리를 받는 창에서만 부른다
 * (관리 밖이면 index.html 을 서버에서 받은 최신 앱이라 404 는 진짜다).
 * 반환: true 면 새로고침이 진행 중(404 를 그리지 않는다), false 면 404 를 보인다.
 */
export async function recoverOutdatedApp(env: OutdatedAppEnv): Promise<boolean> {
  const serverVersion = await env.fetchServerVersion()
  // 같은 버전이면 최신 앱에도 없는 주소(진짜 404)다.
  if (!serverVersion || serverVersion === env.currentVersion) return false
  // 버전별로 기록해 다음 배포에서는 다시 시도한다.
  const key = `wp:outdated-404:${serverVersion}:${env.path}`
  if (env.storage.get(key)) return false

  const registration = await env.getRegistration()
  const timeoutMs = env.timeoutMs ?? INSTALL_TIMEOUT_MS
  const waiting = registration ? await findWaitingWorker(registration, timeoutMs) : null
  // 떠난 화면이거나 저장 안 한 입력(다른 화면에서 남은 노트 동기화 등)이 있으면 적용하지 않는다 — 토스트가 사용자 선택으로 남긴다.
  if (!waiting || env.signal?.aborted || env.hasUnsavedInput()) return false
  return applyWaitingUpdate(
    waiting,
    () => waiting.postMessage({ type: 'SKIP_WAITING' }),
    () => {
      // 적용된 뒤에야 기록한다 — 오프라인·설치 지연·더 새 SW 에 밀림 같은 실패는 다음에 다시 시도하게.
      env.storage.set(key, '1')
      // 그사이 화면을 떠났으면 새로고침하지 않는다 — 새 버전은 다음 새로고침부터 쓰인다.
      if (!env.signal?.aborted) env.reload()
    },
  )
}

/**
 * 대기 중인 새 SW 를 찾는다 — 없으면 업데이트를 확인하고 설치가 끝나기를 제한 시간까지 기다린다.
 * 토스트를 무시한 경우엔 이미 대기 중이라 바로 돌려준다.
 */
async function findWaitingWorker(registration: UpdatableRegistration, timeoutMs: number): Promise<Sw | null> {
  if (registration.waiting) return registration.waiting
  // update() 는 sw.js 요청이 멈추면 끝나지 않을 수 있어 제한 시간을 둔다.
  const updated = await withTimeout(
    registration.update().then(
      () => true,
      () => false,
    ),
    timeoutMs,
  )
  if (!updated) return null
  if (registration.waiting) return registration.waiting
  const installing = registration.installing
  if (!installing) return null
  const state = await waitForSwState(installing, ['installed', 'redundant'], timeoutMs)
  // 설치를 마친 SW 가 곧 대기 중인 SW 다.
  return state === 'installed' ? installing : null
}

/** 서버에 배포된 버전 — version.json(nginx no-cache)을 HTTP 캐시 없이 읽는다. 실패하면 null. */
async function fetchDeployedVersion(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store', signal: AbortSignal.timeout(VERSION_TIMEOUT_MS) })
    if (!res.ok) return null
    const { version } = (await res.json()) as { version?: unknown }
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

/** 실제 브라우저 환경 — sessionStorage 는 막힌 환경(사생활 모드 등)에서 던질 수 있어 감싼다. */
export function browserOutdatedAppEnv(path: string, signal: AbortSignal): OutdatedAppEnv {
  return {
    currentVersion: __APP_VERSION__,
    path,
    signal,
    fetchServerVersion: fetchDeployedVersion,
    getRegistration: () => navigator.serviceWorker.getRegistration(),
    storage: {
      get: (key) => {
        try {
          return sessionStorage.getItem(key)
        } catch {
          return null
        }
      },
      set: (key, value) => {
        try {
          sessionStorage.setItem(key, value)
        } catch {
          // 기록하지 못해도 새로고침한 앱이 서버와 같은 버전이면 다시 시도하지 않는다.
        }
      },
    },
    reload: () => window.location.reload(),
    hasUnsavedInput,
  }
}

/** 이 창이 SW 관리를 받는지 — 관리 밖이면 서버의 최신 앱이라 복구를 시도하지 않는다. */
export function isSwControlled(): boolean {
  return !!navigator.serviceWorker?.controller
}
