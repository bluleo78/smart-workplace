// AI Overview SSE 소비 — GET /api/v1/drive/search-overview 의 text/event-stream 응답을 fetch 로 받는다.
// useWikiAiStream.startWikiAiStream 의 fetch + ReadableStream + 수동 파싱 루프를 미러(GET 이라 body 없음).
// EventSource 미사용 이유: Authorization 헤더 필요(앱이 Bearer 토큰 기반, EventSource 는 커스텀 헤더 미지원).
import { getAccessToken, refreshAccessToken } from '@/api/client'

export interface DriveOverviewStreamArgs {
  query: string
  onDelta: (text: string) => void
  onDone: () => void
  onError: (message: string) => void
}

/** Overview SSE 스트림을 시작하고 즉시 { abort } 를 반환. 파싱은 inner async IIFE. */
export function startDriveOverviewStream(args: DriveOverviewStreamArgs): { abort: () => void } {
  const { query, onDelta, onDone, onError } = args
  const controller = new AbortController()
  const url = `/api/v1/drive/search-overview?q=${encodeURIComponent(query)}`

  void (async () => {
    let token = getAccessToken()
    if (!token) {
      if (!(await refreshAccessToken())) {
        onError('인증이 만료되었습니다. 다시 로그인해주세요.')
        return
      }
      token = getAccessToken()
    }
    const doFetch = (t: string | null) =>
      fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${t}`, Accept: 'text/event-stream' },
        signal: controller.signal,
        credentials: 'include',
      })
    try {
      let response = await doFetch(token)
      if (response.status === 401) {
        if (!(await refreshAccessToken())) {
          onError('인증이 만료되었습니다. 다시 로그인해주세요.')
          return
        }
        token = getAccessToken()
        response = await doFetch(token)
      }
      if (!response.ok || !response.body) {
        onError(`AI Overview 생성에 실패했습니다 (HTTP ${response.status}).`)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = 'message'
      let currentData = ''
      let finished = false

      // SSE 이벤트 블록(빈 줄 구분) 하나를 처리하고 스트림 종료 여부를 반환한다.
      const dispatch = (): boolean => {
        const event = currentEvent
        const data = currentData
        currentEvent = 'message'
        currentData = ''
        if (!data) return false
        if (event === 'delta') {
          try {
            const p = JSON.parse(data) as { text?: string }
            if (typeof p.text === 'string') onDelta(p.text)
          } catch {
            /* 무시 */
          }
          return false
        }
        if (event === 'done') {
          onDone()
          return true
        }
        if (event === 'error') {
          let message = 'AI Overview 생성 중 오류가 발생했습니다.'
          try {
            const p = JSON.parse(data) as { message?: string }
            if (p.message) message = p.message
          } catch {
            /* 무시 */
          }
          onError(message)
          return true
        }
        return false
      }

      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, '')
          buffer = buffer.slice(nl + 1)
          if (line === '') {
            if (dispatch()) {
              finished = true
              break
            }
            continue
          }
          if (line.startsWith(':')) continue // heartbeat
          const ci = line.indexOf(':')
          const field = ci === -1 ? line : line.slice(0, ci)
          const raw = ci === -1 ? '' : line.slice(ci + 1)
          const val = raw.startsWith(' ') ? raw.slice(1) : raw
          if (field === 'event') currentEvent = val
          else if (field === 'data') currentData = currentData ? `${currentData}\n${val}` : val
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      onError('AI Overview 생성 중 네트워크 오류가 발생했습니다.')
    }
  })()

  return { abort: () => controller.abort() }
}
