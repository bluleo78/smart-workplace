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

export function useStickToBottom(depKey: unknown, resetKey?: unknown, initialAnchorId?: string) {
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

  // 최초 위치 잡기(1회): 미읽음 앵커가 있으면 그쪽(center)으로, 없으면 하단으로.
  // 메시지가 비동기로 늦게 로드돼 앵커가 나중에 등장해도 놓치지 않도록,
  // 콘텐츠(스크롤 가능 높이)가 생기기 전엔 '완료'로 확정하지 않고 다음 depKey 에서 재시도한다.
  const initialDone = useRef(false)
  // 앵커 스크롤 완료 전용 플래그 — 앵커 경로(채널 미읽음 진입)에서만 true 가 된다.
  // resetKey 효과가 앵커 스크롤을 덮어쓰지 않도록 하는 유일한 게이트.
  // AIChatPanel(앵커 없음)에서는 영원히 false → resetKey 세션 전환 시 하단 강제가 정상 동작(#455).
  const anchorScrollDone = useRef(false)
  // 앵커를 기다리는 중(initialAnchorId 있고 아직 DOM에 없음) — ResizeObserver 가 하단으로 끌어내리지 않게 차단.
  const pendingAnchor = useRef(!!initialAnchorId)
  useEffect(() => {
    if (initialDone.current) return
    const el = ref.current
    if (!el) return
    if (initialAnchorId) {
      const anchor = el.querySelector(`#${CSS.escape(initialAnchorId)}`) as HTMLElement | null
      if (anchor) {
        // overflow 컨테이너 기준 scrollTop 을 getBoundingClientRect 으로 정확히 계산해 center 로 맞춘다.
        const anchorRect = anchor.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        el.scrollTop = el.scrollTop + (anchorRect.top - elRect.top) - el.clientHeight / 2 + anchor.offsetHeight / 2
        stuckRef.current = false // 하단 아님 — 이후 새 메시지가 화면을 끌어내리지 않게
        pendingAnchor.current = false
        initialDone.current = true
        anchorScrollDone.current = true // 앵커 스크롤 완료 — resetKey 하단 강제 비활성화
      }
      return // 앵커 기대되나 아직 미렌더 → 다음 depKey 에서 재시도
    }
    toBottom()
    if (el.scrollHeight > el.clientHeight) initialDone.current = true // 콘텐츠 생겼을 때만 확정
  }, [depKey, initialAnchorId])

  // resetKey 변경(세션 전환 등): 하단 고정으로 리셋하고 무조건 하단으로(#455).
  // stuck 여부와 무관하게 의도적 전환이므로 항상 최신 메시지를 보여준다.
  // 앵커를 아직 못 잡은 중(pendingAnchor)이거나
  // 앵커 스크롤이 완료된 채널 진입(anchorScrollDone)에서는 하단 강제를 덮어씌우지 않는다.
  // AIChatPanel(초기 앵커 없음): anchorScrollDone=false 유지 → resetKey 전환마다 올바르게 하단으로.
  useEffect(() => {
    if (pendingAnchor.current) return // 앵커를 아직 못 잡은 상태 — 덮어쓰기 금지
    if (anchorScrollDone.current) return // 앵커 스크롤 완료(채널 미읽음 진입) — 세션 reset 의 하단 강제 비활성
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
  // 앵커를 기다리는 중(pendingAnchor)엔 하단으로 끌어내리지 않는다.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stuckRef.current && !pendingAnchor.current) el.scrollTop = el.scrollHeight
    })
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [depKey, resetKey])

  return ref
}
