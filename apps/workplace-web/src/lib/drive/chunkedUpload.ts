/**
 * 드라이브 나눠 올리기(이어 올리기, WP-1520).
 *
 * 큰 파일을 요청 하나로 올리면 연결이 잠깐만 끊겨도 처음부터 다시 올려야 하고, 프록시 본문 한도에도 걸린다.
 * 그래서 20MB 를 넘는 파일은 서버 세션을 열어 조각(chunkSize) 단위로 보내고, 실패한 조각만 다시 보낸다.
 * 세션 id 는 localStorage 에 파일 지문(공간·폴더·이름·크기·수정 시각)으로 남겨, 창을 닫았다가 같은 파일을 다시 고르면
 * 서버가 받은 바이트(receivedBytes)부터 잇는다. 20MB 이하는 지금까지처럼 요청 하나(driveApi.uploadFile)로 올린다.
 */
import axios, { CanceledError } from 'axios'

import { driveApi } from '../../api/drive'
import type { DriveFile, DriveUploadSession } from '../../types/drive'
import { safeLocalStorage } from '../safeLocalStorage'

/** 이 크기를 넘는 파일만 나눠 올린다 — 작은 파일은 왕복을 늘릴 이유가 없다. */
export const CHUNKED_UPLOAD_THRESHOLD_BYTES = 20 * 1024 * 1024

/** 조각 하나의 최대 재시도 횟수와 회차별 대기(ms) — 1·2·4·8·16초 지수 대기. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]

/** 나눠 올리기에 쓰는 API — 테스트가 가짜로 바꿔 끼울 수 있게 driveApi 에서 필요한 것만 고른다. */
export type ChunkedUploadApi = Pick<
  typeof driveApi,
  | 'uploadFile'
  | 'startUploadSession'
  | 'getUploadSession'
  | 'putUploadChunk'
  | 'completeUploadSession'
  | 'cancelUploadSession'
>

/** 세션 id 를 보관하는 저장소 — localStorage 와 같은 모양. 없거나(null) 막혀 있어도 업로드는 돈다(이어 올리기만 못 한다). */
export type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** 바깥 의존성 — 기본값은 실제 API·localStorage·타이머·online 이벤트. 테스트는 가짜를 넣는다. */
export interface ChunkedUploadDeps {
  api: ChunkedUploadApi
  storage: () => SessionStore | null
  /** ms 만큼 기다린다. signal 이 끊기면 즉시 reject 해야 한다. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  /** 온라인이면 바로, 오프라인이면 다시 온라인이 될 때까지 기다린다. signal 이 끊기면 즉시 reject 해야 한다. */
  waitForOnline: (signal?: AbortSignal) => Promise<void>
}

export interface UploadDriveFileOptions {
  signal?: AbortSignal
  /** 전체 진행률(0~100 정수). */
  onProgress?: (percent: number) => void
}

/** signal 이 끊기면 axios 취소 오류로 reject — 호출부(DrivePage)가 axios.isCancel 로 취소 안내를 고른다. */
function abortable(signal: AbortSignal | undefined, register: (done: () => void) => () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CanceledError())
      return
    }
    const onAbort = () => {
      cleanup()
      reject(new CanceledError())
    }
    const cleanup = register(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    })
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const defaultDeps: ChunkedUploadDeps = {
  api: driveApi,
  // localStorage 접근 자체가 던질 수 있다(사파리 사생활 보호·저장소 차단) — 그땐(null) 이어 올리기 없이 올린다.
  storage: safeLocalStorage,
  sleep: (ms, signal) =>
    abortable(signal, (done) => {
      const t = setTimeout(done, ms)
      return () => clearTimeout(t)
    }),
  waitForOnline: (signal) => {
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      return signal?.aborted ? Promise.reject(new CanceledError()) : Promise.resolve()
    }
    return abortable(signal, (done) => {
      const onOnline = () => {
        window.removeEventListener('online', onOnline)
        done()
      }
      window.addEventListener('online', onOnline)
      return () => window.removeEventListener('online', onOnline)
    })
  },
}

/** 세션 id 를 남기는 키 — 같은 자리에 같은 파일을 다시 고를 때만 이어 올리도록 파일 지문을 넣는다. */
export function uploadSessionKey(spaceId: number, folderId: number | null, file: File): string {
  return `drive-upload:${spaceId}:${folderId ?? 'root'}:${file.name}:${file.size}:${file.lastModified}`
}

/**
 * 한 키에 묶은 세션 id 저장소 — 읽기·쓰기·지우기의 어떤 오류도 업로드를 막지 않게 삼킨다.
 * 가득 참·차단이면 이어 올리기만 못 할 뿐 업로드는 계속하고, 지우지 못한 키는 다음 시도에서 GET 404 로 정리된다.
 */
function sessionSlot(store: SessionStore | null, key: string) {
  const attempt = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn()
    } catch {
      return fallback
    }
  }
  return {
    get: () => attempt(() => store?.getItem(key) ?? null, null),
    set: (value: string) => attempt(() => store?.setItem(key, value), undefined),
    remove: () => attempt(() => store?.removeItem(key), undefined),
  }
}

/** 응답 상태 코드 — 응답 없이 끝난(네트워크) 오류는 undefined. */
function statusOf(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined
}

/**
 * 409(UPLOAD_OFFSET_MISMATCH·UPLOAD_INCOMPLETE) 응답 errors.receivedBytes(문자열 숫자) — 서버가 지금까지 받은 바이트.
 * 없거나 숫자가 아니면 null(호출부가 상태 조회로 맞춘다).
 */
function conflictReceivedBytes(err: unknown): number | null {
  if (!axios.isAxiosError(err)) return null
  const raw = (err.response?.data as { errors?: { receivedBytes?: unknown } } | undefined)?.errors?.receivedBytes
  if (raw == null || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * 다시 보내 볼 만한 실패인가 — 응답 없는 axios 네트워크 오류(연결 끊김·시간 초과)·5xx·408·429.
 * 그 밖의 4xx(권한·형식·크기 413·범위 400 등)는 다시 보내도 같으므로 바로 실패로 끝낸다.
 * axios 오류가 아닌 것(TypeError 같은 코드 버그)은 응답이 없어도 재시도하지 않는다 — 다섯 번 기다려 봐야 같은 버그라 바로 드러낸다.
 */
function isRetryable(err: unknown): boolean {
  if (!axios.isAxiosError(err) || axios.isCancel(err)) return false
  if (!err.response) return true
  const { status } = err.response
  return status >= 500 || status === 408 || status === 429
}

/**
 * 세션 키를 지워야 하는 실패인가 — 응답이 왔고 재시도로 풀리지 않는 4xx(400·403·404·413 등). 409(위치 맞추기)는 제외한다.
 * 이런 실패 뒤 키를 남기면 같은 파일을 다시 고를 때마다 같은 세션으로 이어 가다 같은 오류에 막힌다 — 새 세션으로 시작하게 지운다.
 * 네트워크 오류·5xx·408·429 는 다음에 이어 올릴 수 있으니 키를 남긴다.
 */
function shouldForgetSession(err: unknown): boolean {
  const status = statusOf(err)
  return status != null && status !== 409 && !isRetryable(err)
}

/**
 * 드라이브에 파일 하나를 올린다 — 20MB 이하는 요청 하나, 넘으면 세션을 열어 조각으로 이어 올린다.
 * 취소(signal)면 진행 중 요청을 끊고 서버 세션을 지운 뒤 axios 취소 오류를 그대로 던진다.
 * 재시도를 다 써서 실패하면 세션 키를 남겨, 같은 파일을 다시 고르면 끊긴 자리부터 잇는다.
 */
export async function uploadDriveFile(
  spaceId: number,
  folderId: number | null,
  file: File,
  options: UploadDriveFileOptions = {},
  deps: ChunkedUploadDeps = defaultDeps,
): Promise<DriveFile> {
  const { signal, onProgress } = options
  const { api } = deps

  if (file.size <= CHUNKED_UPLOAD_THRESHOLD_BYTES) {
    const { data } = await api.uploadFile(spaceId, folderId, file, signal, onProgress)
    return data
  }

  const slot = sessionSlot(deps.storage(), uploadSessionKey(spaceId, folderId, file))
  // 취소 때 DELETE 할 세션 — 상태 조회 중 취소돼도 지우도록 openSession 이 남긴 세션 id 를 먼저 넣어 둔다.
  let session: Pick<DriveUploadSession, 'id'> | null = null

  // 진행률은 정수 % 가 바뀔 때만 알린다 — onUploadProgress 가 자주 와도 다시 그리기를 줄인다.
  let lastPercent = -1
  const report = (bytes: number) => {
    if (!onProgress) return
    const percent = Math.min(100, Math.floor((bytes * 100) / file.size))
    if (percent !== lastPercent) {
      lastPercent = percent
      onProgress(percent)
    }
  }

  try {
    const opened = await openSession()
    session = opened
    let offset = opened.receivedBytes
    report(offset)

    // 조각 반복 — 서버가 받은 자리(offset)부터 끝까지. 다 보내면 complete, 덜 받았다는 409 면 상태를 다시 맞춰 잇는다.
    for (;;) {
      while (offset < file.size) {
        offset = await sendChunk(opened.id, offset, opened.chunkSize)
        report(offset)
      }
      try {
        const { data } = await api.completeUploadSession(opened.id, signal)
        slot.remove()
        return data
      } catch (err) {
        if (statusOf(err) !== 409 || signal?.aborted) throw err
        // 서버가 아직 다 받지 못했다(UPLOAD_INCOMPLETE) — 응답의 받은 바이트(없으면 상태 조회)로 맞추고 남은 조각을 보낸다.
        const received = conflictReceivedBytes(err) ?? (await api.getUploadSession(opened.id, signal)).data.receivedBytes
        if (received >= file.size) throw err
        offset = received
      }
    }
  } catch (err) {
    if (signal?.aborted || axios.isCancel(err)) {
      // 취소 — 서버 임시 파일을 남기지 않게 세션을 지운다. 지우기 실패는 만료 정리가 맡으니 무시한다.
      if (session) await api.cancelUploadSession(session.id).catch(() => undefined)
      slot.remove()
      throw axios.isCancel(err) ? err : new CanceledError()
    }
    // 재시도로 풀리지 않는 4xx(세션 없음 404·권한 403·형식 400·크기 413 등) — 남긴 키로는 이어 갈 수 없으니 지운다.
    // 네트워크 오류·5xx 등 일시적 실패는 키를 남겨 다음에 같은 파일을 고르면 잇는다.
    if (shouldForgetSession(err)) slot.remove()
    throw err
  }

  /** 남긴 세션이 살아 있으면 그 상태로, 아니면 새 세션을 연다. */
  async function openSession(): Promise<DriveUploadSession> {
    const savedId = slot.get()
    if (savedId) {
      // 상태 조회 중 취소돼도 이 세션을 DELETE 하도록 먼저 잡아 둔다.
      session = { id: savedId }
      try {
        const { data } = await api.getUploadSession(savedId, signal)
        // 같은 지문인데 크기가 다르면(있어선 안 되지만) 믿지 않고 새로 시작한다.
        if (data.size === file.size) return data
      } catch (err) {
        if (statusOf(err) !== 404) throw err
      }
      session = null
      slot.remove()
    }
    const { data } = await api.startUploadSession(
      spaceId,
      {
        ...(folderId != null ? { folderId } : {}),
        fileName: file.name,
        ...(file.type ? { contentType: file.type } : {}),
        size: file.size,
      },
      signal,
    )
    slot.set(data.id)
    return data
  }

  /**
   * offset 부터 조각 하나를 보내고 서버가 받은 다음 offset 을 돌려준다.
   * 실패하면 같은 조각을 최대 5번 다시 보낸다(오프라인이면 온라인이 될 때까지 먼저 기다린 뒤 1·2·4·8·16초 대기).
   * 409 면 서버가 실제로 받은 바이트(응답 errors.receivedBytes, 없으면 상태 조회)로 맞춰 돌려준다 — 앞선 시도가 서버엔 닿았는데 응답만 잃은 경우다.
   */
  async function sendChunk(id: string, offset: number, chunkSize: number): Promise<number> {
    for (let attempt = 0; ; attempt++) {
      const end = Math.min(offset + chunkSize, file.size)
      try {
        const { data } = await api.putUploadChunk(id, offset, file.slice(offset, end), signal, (loaded) =>
          report(offset + Math.min(loaded, end - offset)),
        )
        return data.receivedBytes
      } catch (err) {
        if (signal?.aborted || axios.isCancel(err)) throw err
        if (statusOf(err) === 409) {
          const synced = conflictReceivedBytes(err) ?? (await api.getUploadSession(id, signal)).data.receivedBytes
          if (synced !== offset) return synced
          // 서버 값이 지금 offset 과 같다면 맞출 게 없다 — 재시도 횟수를 써서 무한 반복을 막는다.
        } else if (!isRetryable(err)) {
          throw err
        }
        if (attempt >= RETRY_DELAYS_MS.length) throw err
        await deps.waitForOnline(signal)
        await deps.sleep(RETRY_DELAYS_MS[attempt], signal)
      }
    }
  }
}
