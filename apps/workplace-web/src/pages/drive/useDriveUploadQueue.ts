/**
 * 드라이브 업로드 큐 훅 (WP-1531).
 *
 * 파일 묶음을 순차로 올리며 파일별 상태를 uploadQueueReducer 로 관리한다.
 * 실제 전송 함수(upload)·하위 폴더 만들기(resolveFolder)는 인자로 받아 페이지가 API 를 주입한다.
 * 배치의 자리(root — 공간·폴더)는 start 때 받아 배치 상태에 담고, 콜백마다 그대로 넘긴다.
 * AbortController 하나로 배치 전체를 취소하고, 다시 시도도 새 컨트롤러로 같은 규칙을 따른다.
 * 소유자는 앱 전역 DriveUploadProvider 라 화면 이동으로 언마운트되지 않는다. 끊는 것은 사용자의 취소·닫기와 Provider 의 로그아웃·언마운트 정리다.
 */
import axios from 'axios'
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'

import { extractApiError } from '@/lib/api-error'

import { uploadLimitFor } from './uploadLimit'
import {
  summarize,
  type UploadBatch,
  uploadQueueReducer,
  type UploadRoot,
  type UploadSummary,
} from './uploadQueue'

/** 올릴 파일과 놓은 폴더 기준 하위 경로(버튼 경로는 []). */
export interface UploadTarget {
  file: File
  path: string[]
}

export interface UseDriveUploadQueueOptions {
  /** 배치 자리의 공간에서 부모 폴더 아래 이름으로 폴더를 찾거나 만들어 id 를 준다(merge). 하위 경로를 한 단계씩 만든다. */
  resolveFolder: (root: UploadRoot, parentId: number | null, name: string) => Promise<number>
  upload: (
    root: UploadRoot,
    folderId: number | null,
    file: File,
    signal: AbortSignal,
    onProgress: (p: number) => void,
  ) => Promise<unknown>
  /**
   * 배치가 끝났을 때 — 처음 실행은 취소·실패만 있어도, 화면을 떠난 뒤에도 늘 부른다(성공이 없어도 폴더는 만들어졌을 수 있다).
   * 다시 시도 실행은 무언가 올라갔을 때만 부른다(폴더는 처음 실행에서 이미 만들어져 있다).
   */
  onSettled: (root: UploadRoot) => void
}

/** 한 번의 실행(처음 또는 다시 시도)에 필요한 것 — 렌더를 기다리지 않고 바로 쓰게 함께 넘긴다. */
interface RunContext {
  root: UploadRoot
  /** id → 파일·경로(배치 항목 순서 그대로) */
  targets: UploadTarget[]
  /** 다시 시도 실행인지 — onSettled 를 부를지 정한다 */
  isRetry: boolean
}

/**
 * 경로의 폴더 id — 루트('')에서 시작해 앞에서부터 한 단계씩, 캐시에 없는 단계만 resolveFolder 로 만든다.
 * 재귀 없이 경로 길이만큼만 돌아 반드시 끝난다. 루트가 캐시에 없으면 null(공간 루트)로 본다.
 */
async function resolvePath(
  path: string[],
  cache: Map<string, number | null>,
  resolveFolder: (parentId: number | null, name: string) => Promise<number>,
): Promise<number | null> {
  let parent = cache.get('') ?? null
  for (let i = 1; i <= path.length; i++) {
    const key = path.slice(0, i).join('/')
    const known = cache.get(key)
    if (known !== undefined) {
      parent = known
      continue
    }
    const id = await resolveFolder(parent, path[i - 1])
    cache.set(key, id)
    parent = id
  }
  return parent
}

/** 모두 성공 시 패널이 저절로 닫히기까지의 시간(ms). */
const AUTO_CLOSE_MS = 5000

export function useDriveUploadQueue(opts: UseDriveUploadQueueOptions): {
  batch: UploadBatch | null
  summary: UploadSummary | null
  busy: boolean
  start: (targets: UploadTarget[], root: UploadRoot) => boolean
  cancel: () => void
  retry: (id: string) => void
  close: () => void
} {
  const [batch, dispatch] = useReducer(uploadQueueReducer, null)

  // 콜백(opts)은 매 렌더 바뀔 수 있어 ref 로 최신 값을 읽는다 — 비동기 루프가 옛 클로저를 쓰지 않게.
  const optsRef = useRef(opts)
  // 그린 배치 — retry 가 렌더 뒤의 상태를 읽되 배치가 바뀔 때마다 새 함수가 되지 않게(행 memo 가 유지되게) ref 로 둔다.
  const batchRef = useRef(batch)
  useEffect(() => {
    optsRef.current = opts
    batchRef.current = batch
  })
  // 경로 키 → 대상 폴더 id — 경로 해석의 유일한 캐시. 배치마다 새로 만들고, 다시 시도가 원래 폴더로 가게 배치가 끝나도 남긴다.
  // 빈 경로('')는 start 때 받은 루트 폴더로 미리 채운다.
  const folderCacheRef = useRef<Map<string, number | null>>(new Map())
  // 진행 중 실행의 컨트롤러. 있으면 실행 중이다(동기 판정용 — state 는 렌더 뒤에야 바뀐다).
  const controllerRef = useRef<AbortController | null>(null)

  // 지정한 id 들을 순차 업로드한다. 취소(signal.aborted) 뒤에는 어떤 액션도 보내지 않는다
  // — 리듀서가 상태와 무관하게 progress/done/fail 을 적용하므로 늦은 응답이 취소 행을 되살리면 안 된다.
  // Provider 가 내려간 뒤의 dispatch 는 React 가 무시한다(해 없음).
  const run = useCallback(async (ids: string[], controller: AbortController, ctx: RunContext) => {
    const { signal } = controller
    const { root } = ctx
    let anySucceeded = false
    for (const id of ids) {
      if (signal.aborted) break
      const { file, path } = ctx.targets[Number(id)]
      dispatch({ type: 'begin', id })
      try {
        const limit = uploadLimitFor(file)
        if (file.size > limit.maxBytes) {
          dispatch({ type: 'fail', id, error: `${limit.label} 초과`, retryable: false })
          continue
        }
        const folderId = await resolvePath(path, folderCacheRef.current, (parentId, name) =>
          optsRef.current.resolveFolder(root, parentId, name),
        )
        if (signal.aborted) break
        // 정수 퍼센트가 바뀔 때만 보낸다 — 진행 이벤트는 같은 값으로 자주 와 렌더만 늘린다.
        let lastPercent = 0
        await optsRef.current.upload(root, folderId, file, signal, (percent) => {
          if (signal.aborted || percent === lastPercent) return
          lastPercent = percent
          dispatch({ type: 'progress', id, percent })
        })
        if (signal.aborted) break
        anySucceeded = true
        dispatch({ type: 'done', id })
      } catch (err) {
        if (signal.aborted || axios.isCancel(err)) break
        dispatch({ type: 'fail', id, error: extractApiError(err, '업로드 실패'), retryable: true })
      }
    }
    if (controllerRef.current === controller) controllerRef.current = null
    if (!signal.aborted) dispatch({ type: 'finish' })
    // Provider 언마운트 뒤에도 부른다 — 사용량·목록 캐시가 새 파일(과 놓으며 만든 폴더)을 반영하게.
    if (!ctx.isRetry || anySucceeded) optsRef.current.onSettled(root)
  }, [])

  // 새 컨트롤러로 실행을 시작한다 — start·retry 공용.
  const launch = useCallback(
    (ids: string[], ctx: RunContext) => {
      const controller = new AbortController()
      controllerRef.current = controller
      void run(ids, controller, ctx)
    },
    [run],
  )

  // 진행 중 실행을 끊는다 — 취소·닫기 공용.
  const abortRun = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const start = useCallback(
    (targets: UploadTarget[], root: UploadRoot): boolean => {
      // 진행 중이면 첫 배치의 컨트롤러를 덮어쓰지 않도록 거절한다
      if (controllerRef.current || targets.length === 0) return false
      folderCacheRef.current = new Map([['', root.folderId]])
      dispatch({ type: 'start', root, items: targets })
      launch(
        targets.map((_, i) => String(i)),
        { root, targets, isRetry: false },
      )
      return true
    },
    [launch],
  )

  const cancel = useCallback(() => {
    abortRun()
    dispatch({ type: 'cancel' })
  }, [abortRun])

  const retry = useCallback(
    (id: string) => {
      // 실행 중이거나, 다시 시도 가능한 실패 행이 아니면 무시
      const current = batchRef.current
      const item = current?.items.find((it) => it.id === id)
      if (controllerRef.current || !current || item?.status !== 'failed' || !item.retryable) return
      dispatch({ type: 'retry', ids: [id] })
      launch([id], { root: current.root, targets: current.items, isRetry: true })
    },
    [launch],
  )

  // 닫기 — 패널은 끝난 뒤에만 닫기를 보이지만, 혹시 올리는 중에 닫혀도 보이지 않는 요청이 뒤에서 계속 돌지 않게 끊는다.
  const close = useCallback(() => {
    abortRun()
    dispatch({ type: 'clear' })
  }, [abortRun])

  // 실패·취소 없이 전부 성공한 채 끝나면 잠시 뒤 패널을 저절로 닫는다. 배치가 바뀌거나(새 시작·다시 시도·닫기)
  // 화면을 떠나면 cleanup 이 타이머를 지워, 옛 타이머가 새 배치를 닫지 않는다.
  useEffect(() => {
    if (!batch || batch.running || batch.cancelled || !batch.items.every((it) => it.status === 'done')) return
    const timer = setTimeout(() => dispatch({ type: 'clear' }), AUTO_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [batch])

  const summary = useMemo(() => (batch ? summarize(batch) : null), [batch])

  const busy = batch?.running ?? false
  // 돌려줄 객체를 필드로 memo 한다 — 매 렌더 새 객체면 이를 담는 전역 Provider 의 컨텍스트 값도 매번 바뀌어
  // 큐가 그대로여도 모든 구독자가 다시 그려진다(WP-1534).
  return useMemo(
    () => ({ batch, summary, busy, start, cancel, retry, close }),
    [batch, summary, busy, start, cancel, retry, close],
  )
}
