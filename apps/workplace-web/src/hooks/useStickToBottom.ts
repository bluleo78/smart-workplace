// 채팅 스크롤 — 컨테이너를 하단에 "붙여" 둔다.
// 정책: 마운트 시 하단으로. 의존값(depKey: 보통 메시지 수/마지막 id)이 바뀌면,
// 사용자가 하단 근처(=새 메시지를 보고 있던 상태)일 때만 자동으로 하단 스크롤(점프 방지).
import { useEffect, useRef } from 'react'

// 하단으로 간주하는 여유(px). 이 안쪽이면 "붙어 있음".
const NEAR_BOTTOM_PX = 80

export function useStickToBottom(depKey: unknown) {
  const ref = useRef<HTMLDivElement | null>(null)
  // 직전 렌더 시점에 하단 근처였는지. 스크롤 이벤트로 갱신.
  const stuckRef = useRef(true)

  // 스크롤 위치 추적 — 하단 근처면 stuck=true.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      stuckRef.current = dist <= NEAR_BOTTOM_PX
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // 최초 마운트: 하단으로. (ref 만 읽으므로 의존성 없음)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // depKey 변경(새 메시지 등): 붙어 있었으면 하단으로.
  useEffect(() => {
    const el = ref.current
    if (el && stuckRef.current) el.scrollTop = el.scrollHeight
  }, [depKey])

  return ref
}
