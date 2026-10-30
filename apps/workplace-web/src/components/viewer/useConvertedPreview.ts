import { useCallback, useEffect, useState } from 'react'

import { driveApi } from '../../api/drive'
import { CONVERT_POLL_INTERVAL_MS, CONVERT_POLL_MAX_MS, type ConvertedState, toConvertedState } from './convertedPreview'
import type { ViewerItem } from './types'

const CONVERTING: ConvertedState = { s: 'converting' }

/**
 * 서버 변환 PDF 미리보기 상태를 폴링으로 얻는다(WP-431).
 * - 시도(열기·항목 전환·retry)의 첫 요청에만 `?start=true` — 서버가 이때만 실패 행을 다시 선점한다.
 *   폴링까지 붙이면 잠깐의 BUSY 가 1.5초마다 재선점돼 시도 3회를 몇 초 만에 소진하고 영구 실패로 굳는다.
 * - 202 면 1.5초 뒤 다시(start 없이), 200·404·422·그 밖의 404(error) 면 멈춘다 — 422 는 일시 실패여도 다시 묻지 않고 [다시 시도]에 맡긴다.
 * - 시도 시작부터 90초(서버 변환 예산보다 길게)가 지나면 POLL_TIMEOUT 일시 실패, 요청이 throw 하면 UNAVAILABLE 일시 실패.
 * - 항목 전환·언마운트·retry 때 타이머를 지우고 진행 중 요청을 abort 한다.
 * - enabled 거짓이면 요청하지 않고 state 는 null 이다.
 */
export function useConvertedPreview(item: ViewerItem, enabled: boolean): { state: ConvertedState | null; retry: () => void } {
  // 다시 시도 — 값이 바뀌면 같은 항목도 시작 시각을 새로 잡고 처음부터 묻는다.
  const [attempt, setAttempt] = useState(0)
  const path = item.previewPath
  const source = item.source
  // 결과는 그 결과를 낸 시도 키와 함께 둔다 — 항목 전환·retry 직후 첫 렌더에 이전 시도의 blob·실패가 비치지 않게(이펙트 안 초기화 setState 대신).
  const attemptKey = `${path}#${attempt}`
  const [result, setResult] = useState<{ key: string; state: ConvertedState } | null>(null)
  // 꺼져 있으면 상태 없음(null) — 호출부가 변환 항목인지 다시 따지지 않아도 되게.
  const state = !enabled ? null : result?.key === attemptKey ? result.state : CONVERTING

  useEffect(() => {
    if (!enabled || !path) return
    const key = `${path}#${attempt}`
    const setState = (next: ConvertedState) => setResult({ key, state: next })
    let alive = true
    const controller = new AbortController()
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    // 상한 타이머 — 요청이 응답 없이 매달려 있어도 90초에 끊고 일시 실패로 바꾼다.
    const deadline = setTimeout(() => {
      if (!alive) return
      alive = false
      clearTimeout(pollTimer)
      controller.abort()
      setState({ s: 'failed', code: 'POLL_TIMEOUT', transient: true })
    }, CONVERT_POLL_MAX_MS)
    // 끝(성공·실패) — 더 묻지 않도록 상한 타이머를 지운다.
    const finish = (next: ConvertedState) => {
      alive = false
      clearTimeout(deadline)
      setState(next)
    }

    // 항목 출처가 있으면(공유 링크 미리보기, WP-1227) 그것으로, 없으면 앱 인증 클라이언트로 묻는다 — 응답 모양은 같다.
    const fetchConverted = source?.fetchConverted ?? driveApi.fetchConvertedPreview
    const request = (start: boolean) => {
      fetchConverted(start ? `${path}?start=true` : path, controller.signal)
        .then((r) => {
          if (!alive) return
          const next = toConvertedState(r)
          if (next === 'poll') pollTimer = setTimeout(() => request(false), CONVERT_POLL_INTERVAL_MS)
          else finish(next)
        })
        .catch(() => alive && finish({ s: 'failed', code: 'UNAVAILABLE', transient: true }))
    }
    request(true)

    return () => {
      alive = false
      clearTimeout(pollTimer)
      clearTimeout(deadline)
      controller.abort()
    }
  }, [path, source, enabled, attempt])

  // 고정 참조 — 본문이 [다시 시도] 버튼·자식 props 로 넘겨도 렌더마다 바뀌지 않게.
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { state, retry }
}
