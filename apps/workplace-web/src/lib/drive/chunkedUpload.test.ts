// 드라이브 나눠 올리기(WP-1520) — 조각 나누기·재시도·409 맞추기·이어 올리기·취소·작은 파일 경로를 가짜 API 로 검증한다.
import { AxiosError, type AxiosResponse, CanceledError, type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import type { DriveFile, DriveUploadSession } from '../../types/drive'
import {
  CHUNKED_UPLOAD_THRESHOLD_BYTES,
  type ChunkedUploadApi,
  type ChunkedUploadDeps,
  type SessionStore,
  uploadDriveFile,
  uploadSessionKey,
} from './chunkedUpload'

const MB = 1024 * 1024
const CHUNK = 8 * MB
const SPACE = 7

/** 크기만 맞춘 파일 — 내용은 0 바이트로 채운다. */
function bigFile(size = CHUNKED_UPLOAD_THRESHOLD_BYTES + 5 * MB, name = 'video.mp4'): File {
  return new File([new Uint8Array(size)], name, { type: 'video/mp4', lastModified: 1700000000000 })
}

/** axios 응답 모양(data 만 쓴다). */
function ok<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} as InternalAxiosRequestConfig }
}

/** 상태 코드가 있는 axios 오류 — status 가 없으면 응답 없는 네트워크 오류. */
function httpError(status?: number, data: unknown = {}): AxiosError {
  if (status == null) return new AxiosError('Network Error', 'ERR_NETWORK')
  return new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, {
    data,
    status,
    statusText: '',
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

/** 메모리 저장소 — localStorage 대신. */
function memoryStore(initial: Record<string, string> = {}): SessionStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

const driveFile = { id: 99, name: 'video.mp4' } as DriveFile

function session(over: Partial<DriveUploadSession> = {}): DriveUploadSession {
  return { id: 's-1', chunkSize: CHUNK, receivedBytes: 0, size: bigFile().size, expiresAt: '2026-11-13T00:00:00Z', ...over }
}

/**
 * 서버처럼 receivedBytes 를 기억하는 가짜 API. putFails 에 넣은 오류를 차례로 던진 뒤 정상 처리한다.
 * 보낸 조각(offset·길이)을 puts 에 모은다.
 */
function fakeApi(opts: { size?: number; start?: Partial<DriveUploadSession>; putFails?: unknown[] } = {}) {
  const size = opts.size ?? bigFile().size
  let received = opts.start?.receivedBytes ?? 0
  const putFails = [...(opts.putFails ?? [])]
  const puts: { offset: number; length: number }[] = []
  const api = {
    uploadFile: vi.fn(async () => ok(driveFile)),
    startUploadSession: vi.fn(async () => ok(session({ size, ...opts.start }))),
    getUploadSession: vi.fn(async (id: string) => ok(session({ id, size, receivedBytes: received }))),
    putUploadChunk: vi.fn(async (_id: string, offset: number, chunk: Blob, _s?: AbortSignal, onProgress?: (n: number) => void) => {
      puts.push({ offset, length: chunk.size })
      const fail = putFails.shift()
      if (fail) throw fail
      if (offset !== received) throw httpError(409, { errors: { code: 'UPLOAD_OFFSET_MISMATCH', receivedBytes: String(received) } })
      onProgress?.(chunk.size)
      received = offset + chunk.size
      return ok({ receivedBytes: received })
    }),
    completeUploadSession: vi.fn(async () => ok(driveFile)),
    cancelUploadSession: vi.fn(async () => ok(undefined)),
  }
  return { api, puts, setReceived: (n: number) => (received = n) }
}

function deps(api: Partial<ChunkedUploadApi>, store: SessionStore | null = memoryStore(), over: Partial<ChunkedUploadDeps> = {}) {
  const sleep = vi.fn(async () => {})
  const d: ChunkedUploadDeps = {
    api: api as ChunkedUploadApi,
    storage: () => store,
    sleep,
    waitForOnline: vi.fn(async () => {}),
    ...over,
  }
  return { d, sleep }
}

describe('uploadDriveFile', () => {
  it('20MB 이하 파일은 기존 한 번 올리기(uploadFile)로 보내고 세션을 열지 않는다', async () => {
    const { api } = fakeApi()
    const file = new File([new Uint8Array(1024)], 'a.txt')
    const onProgress = vi.fn()
    const signal = new AbortController().signal
    const result = await uploadDriveFile(SPACE, 3, file, { signal, onProgress }, deps(api).d)
    expect(result).toBe(driveFile)
    expect(api.uploadFile).toHaveBeenCalledWith(SPACE, 3, file, signal, onProgress)
    expect(api.startUploadSession).not.toHaveBeenCalled()
  })

  it('큰 파일은 서버 chunkSize 경계로 나눠 차례로 보내고 complete 후 키를 지운다', async () => {
    const file = bigFile()
    const { api, puts } = fakeApi()
    const store = memoryStore()
    const progress: number[] = []
    const result = await uploadDriveFile(SPACE, null, file, { onProgress: (p) => progress.push(p) }, deps(api, store).d)

    expect(result).toBe(driveFile)
    expect(api.startUploadSession).toHaveBeenCalledWith(
      SPACE,
      { fileName: 'video.mp4', contentType: 'video/mp4', size: file.size },
      undefined,
    )
    // 25MB → 8·8·8·1MB
    expect(puts).toEqual([
      { offset: 0, length: CHUNK },
      { offset: CHUNK, length: CHUNK },
      { offset: 2 * CHUNK, length: CHUNK },
      { offset: 3 * CHUNK, length: file.size - 3 * CHUNK },
    ])
    expect(api.completeUploadSession).toHaveBeenCalledWith('s-1', undefined)
    expect(store.map.size).toBe(0)
    expect(progress[progress.length - 1]).toBe(100)
    expect(progress.every((p) => Number.isInteger(p))).toBe(true)
  })

  it('조각이 실패하면 같은 조각을 대기 후 다시 보낸다(1초·2초)', async () => {
    const { api, puts } = fakeApi({ putFails: [undefined, httpError(), httpError(503)] })
    const { d, sleep } = deps(api)
    await uploadDriveFile(SPACE, null, bigFile(), {}, d)
    // 첫 조각 성공, 둘째 조각이 두 번 실패 후 성공
    expect(puts.slice(0, 4).map((p) => p.offset)).toEqual([0, CHUNK, CHUNK, CHUNK])
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1000, 2000])
  })

  it('다시 보내기 전에 대기보다 먼저 online 을 기다린다', async () => {
    const { api } = fakeApi({ putFails: [httpError()] })
    const order: string[] = []
    const waitForOnline = vi.fn(async () => {
      order.push('online')
    })
    const sleep = vi.fn(async () => {
      order.push('sleep')
    })
    const { d } = deps(api, memoryStore(), { waitForOnline, sleep })
    await uploadDriveFile(SPACE, null, bigFile(), {}, d)
    expect(order).toEqual(['online', 'sleep'])
  })

  it('409 면 응답의 errors.receivedBytes 로 맞춰 상태 조회 없이 그 자리부터 잇는다', async () => {
    const file = bigFile()
    const { api, puts, setReceived } = fakeApi()
    // 첫 조각이 서버엔 닿았는데 응답을 잃은 상황 — 가짜 서버가 이미 8MB 를 받은 상태에서 offset 0 을 보낸다.
    api.putUploadChunk.mockImplementationOnce(async (_id: string, offset: number, chunk: Blob) => {
      puts.push({ offset, length: chunk.size })
      setReceived(CHUNK)
      throw httpError(409, { status: 409, errors: { code: 'UPLOAD_OFFSET_MISMATCH', receivedBytes: String(CHUNK) } })
    })
    const { d, sleep } = deps(api)
    await uploadDriveFile(SPACE, null, file, {}, d)
    expect(puts.map((p) => p.offset)).toEqual([0, CHUNK, 2 * CHUNK, 3 * CHUNK])
    expect(sleep).not.toHaveBeenCalled()
    expect(api.getUploadSession).not.toHaveBeenCalled()
  })

  it.each([{}, { errors: { code: 'UPLOAD_OFFSET_MISMATCH' } }, { errors: { receivedBytes: 'abc' } }])(
    '409 응답에 숫자 receivedBytes 가 없으면(%j) 상태 조회로 맞춘다',
    async (body) => {
      const { api, puts, setReceived } = fakeApi()
      api.putUploadChunk.mockImplementationOnce(async (_id: string, offset: number, chunk: Blob) => {
        puts.push({ offset, length: chunk.size })
        setReceived(CHUNK)
        throw httpError(409, body)
      })
      await uploadDriveFile(SPACE, null, bigFile(), {}, deps(api).d)
      expect(api.getUploadSession).toHaveBeenCalledWith('s-1', undefined)
      expect(puts.map((p) => p.offset)).toEqual([0, CHUNK, 2 * CHUNK, 3 * CHUNK])
    },
  )

  it('완료가 409 UPLOAD_INCOMPLETE 면 errors.receivedBytes 로 맞춰 남은 조각을 보낸 뒤 다시 완료한다', async () => {
    const file = bigFile()
    const { api, puts, setReceived } = fakeApi()
    api.completeUploadSession.mockImplementationOnce(async () => {
      // 서버가 마지막 조각을 잃었다 — 3조각까지만 받은 상태.
      setReceived(3 * CHUNK)
      throw httpError(409, { errors: { code: 'UPLOAD_INCOMPLETE', receivedBytes: String(3 * CHUNK) } })
    })
    await expect(uploadDriveFile(SPACE, null, file, {}, deps(api).d)).resolves.toBe(driveFile)
    expect(api.getUploadSession).not.toHaveBeenCalled()
    expect(puts.map((p) => p.offset)).toEqual([0, CHUNK, 2 * CHUNK, 3 * CHUNK, 3 * CHUNK])
    expect(api.completeUploadSession).toHaveBeenCalledTimes(2)
  })

  it('완료 409 에 receivedBytes 가 없으면 상태 조회로 맞춘다', async () => {
    const file = bigFile()
    const { api, puts, setReceived } = fakeApi()
    api.completeUploadSession.mockImplementationOnce(async () => {
      setReceived(3 * CHUNK)
      throw httpError(409, { errors: { code: 'UPLOAD_INCOMPLETE' } })
    })
    await expect(uploadDriveFile(SPACE, null, file, {}, deps(api).d)).resolves.toBe(driveFile)
    expect(api.getUploadSession).toHaveBeenCalledWith('s-1', undefined)
    expect(puts.map((p) => p.offset)).toEqual([0, CHUNK, 2 * CHUNK, 3 * CHUNK, 3 * CHUNK])
  })

  it.each([400, 403, 404, 413, 422])('%i 같은 재시도 불가 4xx 는 다시 보내지 않고 실패하며 키를 지운다', async (status) => {
    const file = bigFile()
    const { api, puts } = fakeApi({ putFails: [httpError(status)] })
    const store = memoryStore()
    const { d, sleep } = deps(api, store)
    await expect(uploadDriveFile(SPACE, null, file, {}, d)).rejects.toMatchObject({ response: { status } })
    expect(puts).toHaveLength(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(store.map.has(uploadSessionKey(SPACE, null, file))).toBe(false)
  })

  it('완료가 409 로 끝나면(서버는 다 받았다는데 완료 불가) 키를 남긴다', async () => {
    const file = bigFile()
    const { api } = fakeApi()
    api.completeUploadSession.mockRejectedValueOnce(httpError(409))
    const store = memoryStore()
    await expect(uploadDriveFile(SPACE, null, file, {}, deps(api, store).d)).rejects.toMatchObject({ response: { status: 409 } })
    expect(store.map.get(uploadSessionKey(SPACE, null, file))).toBe('s-1')
  })

  it('응답 없는 axios 네트워크 오류만 재시도하고, axios 가 아닌 오류(TypeError)는 바로 던지며 키를 남긴다', async () => {
    const file = bigFile()
    const bug = new TypeError('boom')
    const { api, puts } = fakeApi({ putFails: [bug] })
    const store = memoryStore()
    const { d, sleep } = deps(api, store)
    await expect(uploadDriveFile(SPACE, null, file, {}, d)).rejects.toBe(bug)
    expect(puts).toHaveLength(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(store.map.get(uploadSessionKey(SPACE, null, file))).toBe('s-1')
  })

  it('재시도를 다 쓰면 실패하고 세션 키를 남겨 다음에 이어 올린다', async () => {
    const file = bigFile()
    const fails = Array.from({ length: 6 }, () => httpError(502))
    const { api, puts } = fakeApi({ putFails: fails })
    const store = memoryStore()
    const { d, sleep } = deps(api, store)
    await expect(uploadDriveFile(SPACE, 4, file, {}, d)).rejects.toMatchObject({ response: { status: 502 } })
    expect(puts).toHaveLength(6) // 처음 1번 + 재시도 5번
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1000, 2000, 4000, 8000, 16000])
    expect(store.map.get(`drive-upload:${SPACE}:4:video.mp4:${file.size}:1700000000000`)).toBe('s-1')
    expect(api.cancelUploadSession).not.toHaveBeenCalled()
  })

  it('남긴 세션이 있으면 GET 으로 받은 바이트를 확인해 그 자리부터 잇는다', async () => {
    const file = bigFile()
    const { api, puts } = fakeApi({ start: { receivedBytes: 2 * CHUNK } })
    const store = memoryStore({ [uploadSessionKey(SPACE, null, file)]: 's-old' })
    const progress: number[] = []
    await uploadDriveFile(SPACE, null, file, { onProgress: (p) => progress.push(p) }, deps(api, store).d)
    expect(api.getUploadSession).toHaveBeenCalledWith('s-old', undefined)
    expect(api.startUploadSession).not.toHaveBeenCalled()
    expect(puts.map((p) => p.offset)).toEqual([2 * CHUNK, 3 * CHUNK])
    expect(api.completeUploadSession).toHaveBeenCalledWith('s-old', undefined)
    expect(progress[0]).toBe(Math.floor((2 * CHUNK * 100) / file.size))
  })

  it('남긴 세션이 만료(404)면 키를 지우고 새 세션으로 처음부터 올린다', async () => {
    const file = bigFile()
    const { api, puts } = fakeApi()
    api.getUploadSession.mockRejectedValueOnce(httpError(404))
    const store = memoryStore({ [uploadSessionKey(SPACE, null, file)]: 's-gone' })
    await uploadDriveFile(SPACE, null, file, {}, deps(api, store).d)
    expect(api.startUploadSession).toHaveBeenCalledTimes(1)
    expect(puts[0].offset).toBe(0)
    expect(store.map.size).toBe(0)
  })

  it('취소하면 진행 중 요청을 끊고 세션을 DELETE 하고 키를 지운 뒤 취소 오류를 던진다', async () => {
    const file = bigFile()
    const { api } = fakeApi()
    const controller = new AbortController()
    api.putUploadChunk.mockImplementationOnce(async (_id: string, _o: number, _c: Blob, signal?: AbortSignal) => {
      controller.abort()
      expect(signal?.aborted).toBe(true)
      throw new CanceledError()
    })
    const store = memoryStore()
    const err = await uploadDriveFile(SPACE, null, file, { signal: controller.signal }, deps(api, store).d).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CanceledError)
    expect(api.cancelUploadSession).toHaveBeenCalledWith('s-1')
    expect(store.map.size).toBe(0)
    expect(api.completeUploadSession).not.toHaveBeenCalled()
  })

  it('재시도 대기 중 취소돼도 세션을 지우고 취소 오류를 던진다(DELETE 실패는 무시)', async () => {
    const { api } = fakeApi({ putFails: [httpError()] })
    api.cancelUploadSession.mockRejectedValueOnce(httpError(500))
    const controller = new AbortController()
    const sleep = vi.fn(async () => {
      controller.abort()
      throw new CanceledError()
    })
    const store = memoryStore()
    const err = await uploadDriveFile(SPACE, null, bigFile(), { signal: controller.signal }, deps(api, store, { sleep }).d).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(CanceledError)
    expect(api.cancelUploadSession).toHaveBeenCalledWith('s-1')
    expect(store.map.size).toBe(0)
  })

  it('저장소가 막혀(던져) 있어도 업로드는 끝난다', async () => {
    const { api } = fakeApi()
    const broken: SessionStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    await expect(uploadDriveFile(SPACE, null, bigFile(), {}, deps(api, broken).d)).resolves.toBe(driveFile)
  })
})
