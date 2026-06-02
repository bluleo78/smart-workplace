import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { getAccessToken, refreshAccessToken } from '../api/client'
import { notificationKeys } from './queries/notificationKeys'

// 앱 셸에서 1회 구독하는 알림 실시간 스트림. notify.created 수신 → 목록+카운트 invalidate.
// 네이티브 EventSource 는 Authorization 헤더 미지원 → fetch+ReadableStream 으로 Bearer 토큰 첨부.
export function useNotificationStream() {
  const qc = useQueryClient()

  useEffect(() => {
    let cancelled = false
    let attempt = 0
    let controller: AbortController | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleReconnect = () => {
      if (cancelled) return
      const delay = Math.min(1000 * Math.pow(2, attempt), 60_000) + Math.random() * 1000
      attempt++
      reconnectTimer = setTimeout(connect, delay)
    }

    const handleEvent = (eventName: string) => {
      // 어떤 알림 이벤트든 캐시를 무효화하면 REST 가 최신 목록/카운트를 다시 가져온다.
      if (eventName === 'notify.created') {
        qc.invalidateQueries({ queryKey: notificationKeys.all })
      }
    }

    const connect = async () => {
      if (cancelled) return
      const token = getAccessToken()
      if (!token) {
        scheduleReconnect()
        return
      }
      controller = new AbortController()
      try {
        const response = await fetch('/api/v1/notifications/stream', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
          credentials: 'include',
        })
        if (response.status === 401) {
          const refreshed = await refreshAccessToken()
          if (!refreshed) {
            cancelled = true // 401 → 조용히 중단
            return
          }
          scheduleReconnect()
          return
        }
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        attempt = 0
        // 재(연결) 직후 invalidate — 끊김 동안 놓친 알림을 따라잡는다(스펙 §6: 재연결 시 invalidate).
        // 없으면 다음 라이브 이벤트가 올 때까지 배지가 과소 카운트된다.
        qc.invalidateQueries({ queryKey: notificationKeys.all })

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent = 'message'

        const dispatch = () => {
          handleEvent(currentEvent)
          currentEvent = 'message'
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).replace(/\r$/, '')
            buffer = buffer.slice(nl + 1)
            if (line === '') {
              dispatch()
              continue
            }
            if (line.startsWith(':')) continue // heartbeat
            const ci = line.indexOf(':')
            const field = ci === -1 ? line : line.slice(0, ci)
            const raw = ci === -1 ? '' : line.slice(ci + 1)
            const val = raw.startsWith(' ') ? raw.slice(1) : raw
            if (field === 'event') currentEvent = val
            // data 페이로드는 사용하지 않음(invalidate 만 함)
          }
        }
        if (!cancelled) scheduleReconnect()
      } catch (error) {
        if ((error as Error).name === 'AbortError' || cancelled) return
        scheduleReconnect()
      }
    }

    connect()
    return () => {
      cancelled = true
      controller?.abort()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [qc])
}
