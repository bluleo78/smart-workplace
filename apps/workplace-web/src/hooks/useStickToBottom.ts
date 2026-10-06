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
//  - 컨테이너 자체가 줄어드는 경우(모바일 키보드가 올라와 셸이 줄어듦 등)도 같은 옵저버로 잡는다 —
//    높이만 줄고 scrollTop 은 그대로라 바닥에 있던 마지막 메시지들이 아래로 가려졌다(WP-154 후속).
//  - 사용자가 위로 올리면(휠·터치·키·스크롤바 입력, 또는 콘텐츠 높이 변화 없이 위로 움직인 scroll 이벤트) 하단 고정을
//    즉시 푼다 — 스트리밍으로 콘텐츠가 계속 자라도 올린 위치를 지킨다. 다시 하단 근처로 내리면 고정이 돌아온다(WP-234).
import { useEffect, useRef } from 'react'

import type { EntryAnchor } from '@/lib/chatEntryAnchor'

// 하단으로 간주하는 여유(px). 이 안쪽이면 "붙어 있음".
const NEAR_BOTTOM_PX = 80
// 위로 스크롤하는 키 — 컨테이너에 포커스가 있을 때 누르면 하단 고정을 푼다.
const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])
// 휠·키 입력 뒤 채팅 영역이 실제로 움직였는지 판정하기까지 기다리는 시간(ms) — 부드러운 스크롤의 첫 프레임이 지날 만큼.
const SETTLE_MS = 150

// 앵커 start 정렬 시 위쪽 여백(px) — 카드 테두리가 화면 위 끝에 딱 붙지 않게.
const ANCHOR_START_GAP_PX = 8

/**
 * @param initialAnchor 최초 진입 시 이동할 앵커(id + 정렬). 미전달이면 하단.
 * @param anchorPending true 면 앵커 여부를 아직 판단할 수 없음(예: DM 상세 미로드) — 하단으로 확정하지 않고 기다린다.
 *   메시지가 상세보다 먼저 오면 앵커 없이 하단으로 확정돼 버려 이후 나타난 앵커를 놓치기 때문이다(WP-256).
 */
export function useStickToBottom(
  depKey: unknown,
  resetKey?: unknown,
  initialAnchor?: EntryAnchor,
  anchorPending = false,
) {
  const initialAnchorId = initialAnchor?.id
  const initialAnchorAlign = initialAnchor?.align ?? 'center'
  const ref = useRef<HTMLDivElement | null>(null)
  // 직전 렌더 시점에 하단 근처였는지. 스크롤 이벤트로 갱신.
  const stuckRef = useRef(true)
  // 앵커를 기다리는 중(앵커 미판단이거나, 앵커 id 는 있으나 아직 DOM에 없음) — 스크롤 핸들러·ResizeObserver 가 하단으로 끌어내리지 않게 차단.
  const pendingAnchor = useRef(!!initialAnchorId || anchorPending)

  // 직전에 관측한 scrollTop·콘텐츠 높이 — scroll 이벤트가 사용자가 위로 올린 것인지 판정하는 기준.
  // scroll 이벤트뿐 아니라 프로그램 스크롤(toBottom)·ResizeObserver 에서도 갱신한다.
  const observed = useRef({ top: 0, height: 0 })
  const observe = (el: HTMLDivElement) => {
    observed.current = { top: el.scrollTop, height: el.scrollHeight }
  }

  // 하단으로 스크롤(요소 있을 때만).
  const toBottom = () => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    observed.current = { top: el.scrollTop, height: el.scrollHeight }
  }

  // 스크롤 위치 추적 — 하단 근처면 stuck=true, 사용자가 위로 올리면 stuck=false.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 직전에 본 보이는 높이 — 컨테이너가 줄 때 브라우저의 스크롤 보정(scroll anchoring)이 scroll 이벤트를 먼저 보내는데,
    // 그 시점의 거리로 판정하면 사용자가 스크롤하지 않았는데도 하단 고정이 풀린다. 높이가 바뀐 스크롤은 상태를 유지한다.
    let lastClientHeight = el.clientHeight
    observe(el)
    // 사용자가 위로 올리려는 입력(휠·터치·키·스크롤바)은 scroll 이벤트보다 먼저 와서 고정을 바로 푼다 — 스트리밍처럼 콘텐츠가
    // 매 프레임 자라면 depKey·ResizeObserver 가 바닥으로 다시 맞춰 사용자의 스크롤이 이벤트에 닿기 전에 지워지고, 닿더라도
    // 그 사이 높이가 바뀌어 아래 보정 규칙에 걸려 되돌려졌다(WP-234). 이미 맨 위(올라갈 곳 없음)면 아무 일도 없으니 풀지 않는다 —
    // 짧은 대화에서 헛휠 한 번에 고정이 풀려 이후 응답을 따라가지 않는 일을 막는다.
    // 입력이 실제로 채팅 영역을 움직이지 않을 수도 있다 — 터치 슬롭 안의 작은 끌림(탭·길게 누르기), 안쪽 스크롤러(코드 블록 등)가
    // 소비한 휠. 그러면 scroll 이벤트가 오지 않아 고정이 풀린 채 남는다. 그래서 입력 시점의 위치·고정 상태를 기억해 두고(pendingRelease),
    // 입력이 끝났는데(터치 끝·휠/키/포인터 뒤 잠시) 위치가 그대로면 되돌린다. 위로 움직인 scroll 이벤트가 오면 해제를 확정한다.
    let pendingRelease: { top: number; stuck: boolean } | null = null
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    const release = () => {
      if (el.scrollTop <= 0) return
      pendingRelease ??= { top: el.scrollTop, stuck: stuckRef.current }
      stuckRef.current = false
    }
    const settle = () => {
      clearTimeout(settleTimer)
      if (pendingRelease && Math.abs(el.scrollTop - pendingRelease.top) <= 1) {
        stuckRef.current = pendingRelease.stuck
        // 잠정 해제 동안 자란 콘텐츠만큼 밀려 있을 수 있다 — 고정으로 되돌렸으면 바닥으로 맞춘다.
        if (stuckRef.current && !pendingAnchor.current) toBottom()
      }
      pendingRelease = null
    }
    // 휠·키는 끝을 알리는 이벤트가 없다 — 마지막 입력 뒤 잠시(부드러운 스크롤이 첫 프레임을 움직일 만큼) 기다렸다 판정한다.
    const settleSoon = () => {
      clearTimeout(settleTimer)
      settleTimer = setTimeout(settle, SETTLE_MS)
    }
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY >= 0) return
      release()
      settleSoon()
    }
    // 터치는 손가락이 아래로 끌릴 때가 위로 스크롤이다. 손을 떼면 판정한다.
    let touchY: number | null = null
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? null
    }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY
      if (touchY != null && y != null && y > touchY) release()
    }
    const onTouchEnd = () => {
      touchY = null
      settle()
    }
    // 키보드 스크롤 — 입력창 안의 화살표·Home 은 커서 이동이라 제외한다.
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable="true"]')) return
      if (!UP_KEYS.has(e.key)) return
      release()
      settleSoon()
    }
    // 스크롤바 끌기 — 컨테이너 자신의 내용 폭(clientWidth) 바깥(=스크롤바 영역)을 누른 경우만. 놓으면 판정한다.
    const onPointerDown = (e: PointerEvent) => {
      if (e.target === el && e.offsetX >= el.clientWidth) release()
    }
    const onScroll = () => {
      // 소수 scrollTop 반올림 오차(1px)를 넘는 위쪽 이동만 위로 움직인 것으로 본다.
      const movedUp = el.scrollTop < observed.current.top - 1
      const contentChanged = el.scrollHeight !== observed.current.height
      observe(el)
      if (el.clientHeight !== lastClientHeight) {
        lastClientHeight = el.clientHeight
        if (stuckRef.current) toBottom()
        return
      }
      // 콘텐츠 높이가 그대로인데 위로 움직인 스크롤은 사용자 의도다(입력 이벤트 없이 오는 스크롤 포함) — 고정을 푼다.
      // 입력으로 잠정 해제한 뒤 실제로 위로 움직였으면 해제를 확정한다(높이 변화와 무관 — 사용자 입력이 먼저 있었다).
      if (movedUp && pendingRelease) {
        pendingRelease = null
        clearTimeout(settleTimer)
      }
      if (movedUp && !contentChanged) {
        stuckRef.current = false
        return
      }
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      // 하단 고정 중, 위로 움직이지 않았거나 그 사이 콘텐츠 높이가 바뀐 스크롤은 사용자가 떠난 것이 아니다 —
      // 썸네일이 스켈레톤에서 잠깐 줄었다 커질 때 브라우저 위치 보정(clamp)·스크롤 앵커링이 보낸 이벤트가 ResizeObserver 보다 먼저,
      // 때로는 다음 성장까지 반영된 높이로 도착해 "위로 올림"처럼 보였다(WP-234 W15, 썸네일 2장 복원).
      // 사용자가 실제로 올린 경우는 위 입력 리스너가 이미 고정을 풀어 이 분기에 오지 않는다. 앵커를 기다리는 중엔 끌어내리지 않는다.
      if (stuckRef.current) {
        if (dist > 0 && !pendingAnchor.current) toBottom()
        return
      }
      stuckRef.current = !movedUp && dist <= NEAR_BOTTOM_PX
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', settle)
    el.addEventListener('pointercancel', settle)
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      clearTimeout(settleTimer)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', settle)
      el.removeEventListener('pointercancel', settle)
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // 최초 위치 잡기(1회): 앵커가 있으면 그쪽(구분선=center, 상단 캐치업 카드=start)으로, 없으면 하단으로.
  // 메시지가 비동기로 늦게 로드돼 앵커가 나중에 등장해도 놓치지 않도록,
  // 콘텐츠(스크롤 가능 높이)가 생기기 전엔 '완료'로 확정하지 않고 다음 depKey 에서 재시도한다.
  const initialDone = useRef(false)
  // 앵커 스크롤 완료 전용 플래그 — 앵커 경로(채널 미읽음 진입)에서만 true 가 된다.
  // resetKey 효과가 앵커 스크롤을 덮어쓰지 않도록 하는 유일한 게이트.
  // AIChatPanel(앵커 없음)에서는 영원히 false → resetKey 세션 전환 시 하단 강제가 정상 동작(#455).
  const anchorScrollDone = useRef(false)
  useEffect(() => {
    if (initialDone.current) return
    const el = ref.current
    if (!el) return
    if (anchorPending) {
      pendingAnchor.current = true
      return // 앵커 판단 전 — 확정하지 않고 다음 렌더에서 재시도
    }
    if (initialAnchorId) {
      const anchor = el.querySelector(`#${CSS.escape(initialAnchorId)}`) as HTMLElement | null
      if (anchor) {
        // overflow 컨테이너 기준 scrollTop 을 getBoundingClientRect 으로 정확히 계산한다.
        // center = 앵커를 가운데로(구분선), start = 앵커 윗변을 위쪽에(키 큰 캐치업 카드가 잘리지 않게).
        const anchorRect = anchor.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        const offset = anchorRect.top - elRect.top
        el.scrollTop =
          initialAnchorAlign === 'start'
            ? el.scrollTop + offset - ANCHOR_START_GAP_PX
            : el.scrollTop + offset - el.clientHeight / 2 + anchor.offsetHeight / 2
        stuckRef.current = false // 하단 아님 — 이후 새 메시지가 화면을 끌어내리지 않게
        pendingAnchor.current = false
        initialDone.current = true
        anchorScrollDone.current = true // 앵커 스크롤 완료 — resetKey 하단 강제 비활성화
        return
      }
      pendingAnchor.current = true
      return // 앵커 기대되나 아직 미렌더 → 다음 depKey 에서 재시도
    }
    pendingAnchor.current = false
    toBottom()
    if (el.scrollHeight > el.clientHeight) initialDone.current = true // 콘텐츠 생겼을 때만 확정
  }, [depKey, initialAnchorId, initialAnchorAlign, anchorPending])

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
  // 앵커를 기다리는 중엔 내리지 않는다 — 바닥의 마지막 메시지가 보이면 자동 읽음 처리돼 앵커(캐치업)가 무의미해진다(WP-256).
  useEffect(() => {
    if (stuckRef.current && !pendingAnchor.current) toBottom()
  }, [depKey])

  // 콘텐츠 높이 변화(비동기 마크다운/지연 위젯/이미지) 추적 — 하단 고정 상태면 계속 하단 유지.
  // scrollHeight 증가를 잡으려면 콘텐츠(자식)를, 보이는 높이(clientHeight) 변화를 잡으려면 컨테이너(el)를 관찰한다.
  // 컨테이너가 줄 때는 스크롤 이벤트가 오지 않아 stuck 이 직전 값(하단 고정)으로 남아 있으므로 그대로 하단으로 맞추면 된다.
  // depKey/resetKey 가 바뀌면 교체된 콘텐츠로 옵저버를 다시 건다.
  // 앵커를 기다리는 중(pendingAnchor)엔 하단으로 끌어내리지 않는다.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stuckRef.current && !pendingAnchor.current) el.scrollTop = el.scrollHeight
      // 높이 변화로 브라우저가 scrollTop 을 보정(clamp)했을 수 있다 — 기준을 지금 값으로 맞춰, 뒤따르는 scroll 이벤트가
      // 이 보정을 사용자의 위쪽 스크롤로 오판하지 않게 한다.
      observe(el)
    })
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [depKey, resetKey])

  return ref
}
