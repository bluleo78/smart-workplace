// 메시지 스크롤 영역 — overflow 컨테이너를 소유하고 하단 고정(useStickToBottom)을 적용한다.
// ChannelPage/DmPage 의 기존 `<div className="min-h-0 flex-1 overflow-y-auto">` 를 대체.
// older 를 주면 위쪽 끝에 이전 메시지 로더(sentinel)를 두고, 앞 페이지가 붙어도 보던 위치를 지킨다(WP-1471).
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'

import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import type { LoadMoreQuery } from '@/hooks/useLoadMoreSentinel'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import type { EntryAnchor } from '@/lib/chatEntryAnchor'

// 이전 메시지 무한 조회 — useChannelMessages 결과를 그대로 넘길 수 있는 모양.
type OlderMessagesQuery = LoadMoreQuery &
  Pick<UseInfiniteQueryResult<InfiniteData<unknown>, Error>, 'isFetchingNextPage' | 'data'>

interface MessageScrollAreaProps {
  // 하단 고정 트리거 — 보통 마지막 메시지 id + 개수 조합.
  depKey: unknown
  // 최초 진입 시 이 앵커로 스크롤(미읽음 구분선=center, 상단 캐치업 카드=start). 미전달이면 하단.
  initialAnchor?: EntryAnchor
  // 앵커 여부를 아직 판단할 수 없으면 true — 하단으로 확정하지 않고 기다린다(예: DM 상세 미로드).
  anchorPending?: boolean
  // 이전 메시지(앞 페이지) 무한 조회 — 주면 맨 위로 올렸을 때 앞 페이지를 받아 위에 붙인다(WP-1471). 없으면 로더 없음.
  older?: OlderMessagesQuery
  children: ReactNode
}

export function MessageScrollArea({ depKey, initialAnchor, anchorPending, older, children }: MessageScrollAreaProps) {
  // 최초 위치 잡기(앵커 스크롤 또는 하단 이동)가 끝났는지 — 이 뒤에만 위쪽 sentinel 을 켠다.
  // 첫 렌더(scrollTop 0)·앵커 대기 중에 켜면 sentinel 이 화면(여유 200px) 안이라 앞 페이지를 줄줄이 받는다.
  const [positioned, setPositioned] = useState(false)
  const markPositioned = useCallback(() => setPositioned(true), [])
  const stickRef = useStickToBottom(depKey, undefined, initialAnchor, anchorPending, markPositioned)

  // 스크롤 컨테이너 요소 — sentinel 의 IntersectionObserver root 로 쓰려고 state 로도 잡는다.
  // root 가 null 이면 뷰포트로 떨어져 rootMargin 이 컨테이너 클리핑에 먹힌다(WP-94) → 요소가 생기기 전엔 sentinel 을 끈다.
  // callback ref 는 안정적이어야 한다 — 매 렌더 새 함수면 React 가 null→요소를 다시 붙여 setState 가 반복된다.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      stickRef.current = el
      setContainer(el)
    },
    [stickRef],
  )

  const pageCount = older?.data?.pages.length ?? 0
  const hasOlder = !!older?.hasNextPage
  const sentinelEnabled = !!older && !!container && positioned && pageCount > 0

  // ── 앞 페이지가 붙을 때 보던 위치 보존 ──
  // 바닥에서의 거리(scrollHeight - scrollTop)를 기억해 두었다가, 페이지 수가 늘면 같은 거리로 되돌린다.
  // 절대값으로 맞추는 이유: Chromium 스크롤 앵커링이 이미 scrollTop 을 옮겼을 수도, 아닐 수도(맨 위 0 이면 앵커링 안 함) 있다 —
  // 늘어난 높이만큼 `+=` 하면 앵커링이 옮긴 경우 두 번 밀린다. 바닥 기준 절대값은 어느 쪽이든 같은 결과다.
  // overflow-anchor 는 건드리지 않는다 — useStickToBottom 의 하단 고정 판정(WP-234·WP-1200)이 지금의 앵커링 동작을 전제로 한다.
  // 마지막 페이지가 붙는 커밋에 로더 행(고정 높이)이 함께 사라지는 것도 바닥 기준이라 그대로 흡수된다.
  // 바닥에 붙어 있으면 저장값은 clientHeight(= scrollHeight - 최대 scrollTop)라 되돌린 뒤에도 바닥이다.
  const distFromBottom = useRef(0)
  const prevPageCount = useRef(pageCount)
  // 지금 거리를 저장한다. 컬럼이 숨겨진 동안(모바일에서 스레드를 열어 display:none → clientHeight 0)은 기하가 0 으로 무너져 있어
  // 저장하지 않는다 — 덮어쓰면 다시 보일 때 읽던 위치를 잃는다.
  const saveDistance = useCallback(() => {
    const el = stickRef.current
    if (el && el.clientHeight > 0) distFromBottom.current = el.scrollHeight - el.scrollTop
  }, [stickRef])
  // 순서 중요: 되돌리기 이펙트가 저장 이펙트보다 먼저 선언돼야 한다 — 저장이 먼저 돌면 붙은 뒤의 기하로 덮어써 되돌리기가 무효가 된다.
  // ResizeObserver 콜백은 커밋(레이아웃 이펙트) 뒤에 오므로 되돌리기는 붙기 전 값을 쓴다.
  useLayoutEffect(() => {
    const prev = prevPageCount.current
    prevPageCount.current = pageCount
    // 0→1(첫 로드)은 최초 위치 잡기(useStickToBottom) 몫이다 — 대화를 바꿔 다시 마운트됐을 때 낡은 거리를 쓰지 않게 건너뛴다.
    // DOM 은 ref 로 만진다 — state(container)를 고치는 것은 React 규칙 위반이다(react-hooks/immutability).
    const el = stickRef.current
    if (!el || el.clientHeight === 0 || prev < 1 || pageCount <= prev) return
    el.scrollTop = el.scrollHeight - distFromBottom.current
  }, [pageCount, stickRef])
  // 저장 시점 1 — 메시지가 바뀐 커밋(새 메시지·앞 페이지, 되돌린 뒤). 렌더마다 재지 않는다 — 입력·AI 버블 등 부모가 다시 그려질
  // 때마다 scrollHeight 를 읽으면 강제 레이아웃이 생긴다.
  useLayoutEffect(saveDistance, [depKey, pageCount, saveDistance])
  // 저장 시점 2·3 — 사용자 스크롤, 그리고 렌더 없이 바뀌는 높이(화면 밖 이미지·썸네일 로드, 컨테이너 크기 변화).
  // 로더 행이 생기고 사라지면 자식이 바뀌므로 그때 다시 건다.
  useLayoutEffect(() => {
    if (!container) return
    container.addEventListener('scroll', saveDistance, { passive: true })
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(saveDistance)
      ro.observe(container)
      for (const child of Array.from(container.children)) ro.observe(child)
    }
    return () => {
      container.removeEventListener('scroll', saveDistance)
      ro?.disconnect()
    }
  }, [container, saveDistance, hasOlder])

  return (
    <div ref={setRefs} className="min-h-0 flex-1 overflow-y-auto" data-testid="message-scroll-area">
      {older && (
        // 이전 메시지 로더 — 공용 무한 스크롤 푸터(WP-182)를 위쪽에 둔다. 앞 페이지가 있는 동안 늘 같은 높이(h-10)로 마운트해
        // 받는 중 문구가 생기고 사라져도 화면이 들썩이지 않는다. 다음 페이지 실패 시 자동 로드는 멈추고 「다시 시도」 버튼이 보인다.
        // root 는 이 스크롤 컨테이너, enabled 는 최초 위치 잡기 뒤에만(위 positioned 참조).
        <LoadMoreFooter
          query={older}
          root={container}
          enabled={sentinelEnabled}
          errorLabel="이전 메시지를 불러오지 못했습니다 — 다시 시도"
          className="flex h-10 items-center justify-center py-0"
          data-testid="message-older-loader"
        />
      )}
      {children}
    </div>
  )
}
