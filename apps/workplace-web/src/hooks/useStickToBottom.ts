// 채팅 스크롤 — 컨테이너를 하단에 "붙여" 둔다.
// 정책:
//  - 마운트 시 하단으로.
//  - depKey(보통 메시지 수/마지막 id·길이)가 바뀌면, 사용자가 하단 근처(=새 메시지를
//    보고 있던 상태)일 때만 자동으로 하단 스크롤(점프 방지) — 스트리밍/새 메시지용.
//  - resetKey(옵션, 보통 세션 id)가 바뀌면 의도적 전환으로 보고 무조건 하단으로 +
//    하단 고정 상태로 리셋 — 이전 메시지를 보려 위로 올린 상태에서 세션을 바꿔도
//    최근 메시지가 보이도록 한다(#455).
//  - 마크다운/지연(Suspense) 위젯/이미지가 비동기로 렌더되며 높이가 나중에 커지는 경우까지
//    따라가도록 ResizeObserver 로, 하단 고정 상태면 콘텐츠 높이 변화 때마다 다시 하단으로.
import { useEffect, useRef } from 'react'

// 하단으로 간주하는 여유(px). 이 안쪽이면 "붙어 있음".
const NEAR_BOTTOM_PX = 80

export function useStickToBottom(depKey: unknown, resetKey?: unknown) {
  const ref = useRef<HTMLDivElement | null>(null)
  // 직전 렌더 시점에 하단 근처였는지. 스크롤 이벤트로 갱신.
  const stuckRef = useRef(true)

  // 하단으로 스크롤(요소 있을 때만).
  const toBottom = () => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }

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

  // 최초 마운트: 하단으로.
  useEffect(() => {
    toBottom()
  }, [])

  // resetKey 변경(세션 전환 등): 하단 고정으로 리셋하고 무조건 하단으로(#455).
  // stuck 여부와 무관하게 의도적 전환이므로 항상 최신 메시지를 보여준다.
  useEffect(() => {
    stuckRef.current = true
    toBottom()
  }, [resetKey])

  // depKey 변경(새 메시지/스트리밍 델타): 붙어 있었으면 하단으로.
  useEffect(() => {
    if (stuckRef.current) toBottom()
  }, [depKey])

  // 콘텐츠 높이 변화(비동기 마크다운/지연 위젯/이미지) 추적 — 하단 고정 상태면 계속 하단 유지.
  // el 자체는 clientHeight 만 바뀌므로 scrollHeight 증가를 잡으려면 콘텐츠(자식)를 관찰한다.
  // depKey/resetKey 가 바뀌면 교체된 콘텐츠로 옵저버를 다시 건다.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stuckRef.current) el.scrollTop = el.scrollHeight
    })
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [depKey, resetKey])

  return ref
}
