// 위키 인에디터 /ai 토큰 스트리밍 — POST /wiki/pages/{pageId}/ai 의 SSE 응답을 소비한다.
// useChatStream 의 fetch + ReadableStream + 수동 SSE 파싱 루프만 미러(재연결/백오프는 제외 —
// AI 1회 생성은 구독이 아니라 단발 요청이라 재연결이 부적절). Authorization 헤더가 필요해
// native EventSource 대신 fetch 를 쓴다(EventSource 는 커스텀 헤더 미지원). AbortController 노출.

import { getAccessToken, refreshAccessToken } from '../api/client'

export interface WikiAiStreamArgs {
  pageId: number
  action:
    | 'summarize'
    | 'draft'
    | 'continue'
    | 'rewrite_tone'
    | 'translate'
    | 'expand'
    | 'condense'
    | 'polish'
  prompt?: string
  selection?: string
  // 토큰 델타 1개 — 커서 위치에 즉시 삽입.
  onDelta: (text: string) => void
  // 정상 종료(done 이벤트) — 자동저장 디바운스가 이어받는다.
  onDone: () => void
  // 에러(error 이벤트/네트워크/HTTP 실패) — 토스트 + 생성 중단.
  onError: (message: string) => void
}

/** /ai SSE 스트림을 시작하고 즉시 { abort } 를 반환한다. 파싱은 inner async IIFE 에서 진행. */
export function startWikiAiStream(args: WikiAiStreamArgs): { abort: () => void } {
  const { pageId, action, prompt, selection, onDelta, onDone, onError } = args
  const controller = new AbortController()

  // 즉시 동기로 abort 핸들을 반환하기 위해 본 처리는 IIFE 로 비동기 실행.
  void (async () => {
    // 토큰이 없으면(만료/미설정) 먼저 refresh 시도. raw fetch 는 axios refresh 인터셉터를 안 타므로 직접 갱신.
    let token = getAccessToken()
    if (!token) {
      const ok = await refreshAccessToken()
      if (!ok) {
        onError('인증이 만료되었습니다. 다시 로그인해주세요.')
        return
      }
      token = getAccessToken()
    }

    try {
      let response = await fetch(`/api/v1/wiki/pages/${pageId}/ai`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, prompt, selection }),
        signal: controller.signal,
        credentials: 'include',
      })

      // access token 만료 → 직접 refresh 후 1회 재시도(axios 인터셉터를 안 타는 raw fetch 경로).
      if (response.status === 401) {
        const ok = await refreshAccessToken()
        if (!ok) {
          onError('인증이 만료되었습니다. 다시 로그인해주세요.')
          return
        }
        token = getAccessToken()
        response = await fetch(`/api/v1/wiki/pages/${pageId}/ai`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action, prompt, selection }),
          signal: controller.signal,
          credentials: 'include',
        })
      }

      if (!response.ok || !response.body) {
        onError(`AI 생성에 실패했습니다 (HTTP ${response.status}).`)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = 'message'
      let currentData = ''
      let finished = false

      // 빈 줄(이벤트 경계)에서 누적 event/data 를 디스패치. delta/done/error 분기.
      const dispatch = (): boolean => {
        const event = currentEvent
        const data = currentData
        currentEvent = 'message'
        currentData = ''
        if (!data) return false
        if (event === 'delta') {
          try {
            const parsed = JSON.parse(data) as { text?: string }
            if (typeof parsed.text === 'string') onDelta(parsed.text)
          } catch {
            // 잘못된 SSE 데이터 무시
          }
          return false
        }
        if (event === 'done') {
          onDone()
          return true // 스트림 종료
        }
        if (event === 'error') {
          let message = 'AI 생성 중 오류가 발생했습니다.'
          try {
            const parsed = JSON.parse(data) as { message?: string }
            if (parsed.message) message = parsed.message
          } catch {
            // 무시
          }
          onError(message)
          return true // 스트림 종료
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
          if (line.startsWith(':')) continue // heartbeat/comment
          const ci = line.indexOf(':')
          const field = ci === -1 ? line : line.slice(0, ci)
          const raw = ci === -1 ? '' : line.slice(ci + 1)
          const val = raw.startsWith(' ') ? raw.slice(1) : raw
          if (field === 'event') currentEvent = val
          else if (field === 'data') currentData = currentData ? `${currentData}\n${val}` : val
        }
      }
    } catch (error) {
      // 사용자 취소(abort)는 조용히 무시.
      if ((error as Error).name === 'AbortError') return
      onError('AI 생성 중 네트워크 오류가 발생했습니다.')
    }
  })()

  return { abort: () => controller.abort() }
}
