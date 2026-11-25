import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { isEditableTarget, isPlainEscape } from '@/lib/escapeOverlay'

/**
 * 서랍 껍데기(WP-2091) — 노드 설정·워크플로우 개요 서랍이 함께 쓰는 틀. 머리 줄(제목 + 「서랍 닫기」)과 본문을 그린다.
 * 화면 고정(Sheet)이 아니라 캔버스의 flex 형제라 캔버스를 밀어내고 앱 옆 패널(AI·도움말)을 덮지 않는다.
 * 서랍 안에서 Esc 를 누르면 닫는다 — 안쪽 컨트롤이 이미 Esc 를 썼거나(defaultPrevented) 입력 칸 안의 Esc 면 그 칸의 일로 두고 닫지 않는다(칸의 포커스만 푼다).
 */
export function DrawerShell({ label, heading, onClose, children }: {
  label: '노드 설정' | '워크플로우 개요'
  /** 머리 줄 왼쪽 — 아이콘·h3 제목 등. 닫기 단추는 껍데기가 단다 */
  heading: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  // 좁은 폭에서는 서랍이 캔버스 아래로 쌓여 뷰포트 바깥(이슈 재현: y 855 / 뷰포트 844)에 열릴 수 있다 —
  // 그 자리에서는 아무 일도 안 일어난 것처럼 보여 노드를 누른 것이 티가 나지 않는다.
  // 서랍이 열릴 때(부모가 key 로 다시 그리므로 새로 마운트될 때마다) 머리 줄만 보이는 자리로 스크롤한다.
  //
  // - 머리 줄만 맞추는 까닭: 서랍 전체를 맞추면 짧은 화면(390×664)에서는 nearest 가 서랍 높이를 모두 끌어당겨
  //   방금 누른 노드가 위로 밀려 사라진다. 머리 줄(아이콘·제목·닫기)이 보이면 그 자리에서 편집을 이어갈 수 있다.
  // - 세로로 쌓였거나 머리 줄이 뷰포트 밖일 때만 도는 까닭: 넓은 폭의 나란한 배치에서 마운트마다 페이지를
  //   내리면, 그래프가 화면 아래로 잘린 채 노드를 누를 때 노드가 커서 밑으로 밀려 움직인다(WP-2041 지적 1).
  const asideRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const aside = asideRef.current
    if (!aside) return
    // 머리 줄 — 서랍의 첫 자식
    const head = aside.firstElementChild
    if (!(head instanceof HTMLElement)) return
    const headBox = head.getBoundingClientRect()
    const headOutside = headBox.top < 0 || headBox.bottom > window.innerHeight
    // 배치는 부모 flex 방향으로 본다 — @3xl 이상이면 캔버스 오른쪽(가로), 그 아래는 세로로 쌓임
    const parent = aside.parentElement
    const stacked = parent !== null && getComputedStyle(parent).flexDirection === 'column'
    if (!stacked && !headOutside) return
    head.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    // 좁으면 폭 전체로 캔버스 아래에 쌓이고(선이 서랍 위쪽), @3xl 이상에서만 캔버스 오른쪽 380px(왼쪽 경계선) — 판단 기준은 부모 @container(뷰포트 아님).
    // 세로로 쌓일 때는 높이를 60dvh 로 막아 overflow-y-auto 가 안쪽에서 돈다 — 막지 않으면 서랍이 늘어날 때마다 페이지가 길어져 스크롤이 두 겹이 된다.
    // dvh 로 잰 까닭: 60vh 는 모바일 주소창이 늘어나는 동안 화면보다 커 서랍 바닥이 잘릴 수 있다.
    <aside
      ref={asideRef}
      aria-label={label}
      // 개요↔노드 서랍이 바뀔 때 서랍 안에 있던 포커스를 새 서랍(이 영역)으로 옮길 수 있게 한다 — 탭 순서에는 넣지 않는다
      tabIndex={-1}
      className="flex outline-none max-h-[60dvh] w-full shrink-0 flex-col overflow-y-auto border-t bg-card text-sm @3xl:max-h-none @3xl:w-[380px] @3xl:shrink-0 @3xl:border-t-0 @3xl:border-l"
      onKeyDown={(event) => {
        // 안쪽 컨트롤(메뉴·입력 조합 등)이 Esc 를 먼저 썼거나 한글 조합 중이면 서랍은 닫지 않는다(hooks/useIssueOrigin 과 같은 가드, WP-2091)
        if (!isPlainEscape(event.nativeEvent)) return
        // 입력 칸·선택 칸·편집기 안의 Esc 는 서랍이 아니라 그 칸의 몫이다 — 쓰던 글(출력 키 초안 등)을 잃지 않게 칸의 포커스만 풀고 서랍은 남긴다.
        // 한 번 더 누르면(포커스가 칸 밖) 닫힌다. 전역 Esc(AI 패널 닫기)가 함께 닫히지 않게 처리했음은 알린다.
        if (isEditableTarget(event.target)) {
          event.preventDefault()
          // blur() 는 포커스를 body 로 보내 두 번째 Esc 가 서랍 밖(window)에서 시작해 AI 패널을 닫는다 — 서랍 자신(tabIndex=-1)으로 옮겨 두 번째 Esc 가 서랍 안에서 닫게 한다
          asideRef.current?.focus()
          return
        }
        // 앱 전역 Esc(AI 패널 닫기 등)까지 함께 닫히지 않게 처리했음을 알린다 — 한 번에 하나만 닫힌다
        event.preventDefault()
        onClose()
      }}
    >
      <div className="flex items-center gap-2 p-3">
        {heading}
        <Button type="button" variant="ghost" size="icon-sm" className="ml-auto shrink-0" aria-label="서랍 닫기" onClick={onClose}><X /></Button>
      </div>
      {children}
    </aside>
  )
}

/** 「YAML 에서 고치기」 단추 — 서랍·그래프 오류 카드가 같은 이름·모양으로 YAML 보기에 넘긴다(WP-2091). */
export function YamlFixButton({ onClick }: { onClick: () => void }) {
  return <Button type="button" variant="outline" size="sm" onClick={onClick}>YAML 에서 고치기</Button>
}

/** 서랍 안 절 하나 — 34px 소제목 줄과 본문. 서랍 제목이 h3 라 절 제목은 h4(제목 단계 건너뛰기 없음 — WP-2054). */
export function DrawerSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t">
      <div className="flex h-[34px] items-center justify-between px-3">
        <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
        {action}
      </div>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </section>
  )
}
