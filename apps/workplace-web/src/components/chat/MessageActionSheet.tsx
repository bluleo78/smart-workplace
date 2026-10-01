// 메시지 작업 바텀 시트 — 모바일 터치 셸에서 메시지를 길게 누르면 뜬다(hover 툴바의 터치 대체).
// 첫 줄은 빠른 반응 이모지(데스크톱 피커와 같은 집합, ＋ 로 전체 목록 펼침), 그 아래 이 메시지에 허용된 작업 행(44px).
// 팀 채팅(MessageList)과 이슈 채팅(ChatMessageList)이 목록당 하나씩 두고, 어떤 메시지·작업인지는 호출처가 정한다.
import { Plus } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'

import { PICKER_EMOJIS, QUICK_EMOJIS } from '@/components/chat/emojiSets'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export interface MessageSheetAction {
  /** testid 접미사(`message-action-<key>`)이자 React key. */
  key: string
  label: string
  icon: ReactNode
  onSelect: () => void
  /** 파괴적 작업(삭제) — 빨간 글자. */
  destructive?: boolean
}

export function MessageActionSheet({
  open,
  onClose,
  onReact,
  actions,
  preview,
}: {
  open: boolean
  onClose: () => void
  /** 반응 토글. 없으면(이슈 채팅·미전송 메시지) 이모지 줄을 그리지 않는다. */
  onReact?: (emoji: string) => void
  actions: MessageSheetAction[]
  /** 스크린리더용 대상 메시지 요약(시트 설명). */
  preview?: string
}) {
  // 전체 이모지 목록 펼침 — 닫을 때마다 접힌 상태로 되돌린다.
  const [allEmojis, setAllEmojis] = useState(false)
  const close = () => {
    setAllEmojis(false)
    onClose()
  }
  // 작업 행(스레드·복사·수정·삭제)으로 닫혔는가 — 그때는 포커스를 되돌리지 않는다(onCloseAutoFocus 참조).
  const ranAction = useRef(false)
  // 열 때 포커스가 있던 요소(스크린리더용 "메시지 작업" 버튼 등). 트리거(SheetTrigger)가 없는 시트라 Radix 가 직접 되돌려 주지 않는다.
  const returnFocus = useRef<HTMLElement | null>(null)
  // 시트를 먼저 닫고 작업을 실행한다 — 삭제 실행 취소 토스트(z-40)가 시트 오버레이(z-50) 밑에 깔리지 않게.
  const run = (fn: () => void, isAction = false) => {
    ranAction.current = isAction
    close()
    fn()
  }
  const emojiButton = (e: string) => (
    <button
      key={e}
      type="button"
      data-testid={`message-action-react-${e}`}
      aria-label={`${e} 반응`}
      onClick={() => run(() => onReact?.(e))}
      className="flex size-11 items-center justify-center rounded-full text-2xl active:bg-accent"
    >
      {e}
    </button>
  )

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid="message-action-sheet"
        className="max-h-[85dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
        // 포커스 이동 전(마운트 직후)에 호출되므로 activeElement 는 아직 시트를 연 쪽이다.
        onOpenAutoFocus={() => {
          const el = document.activeElement
          returnFocus.current = el instanceof HTMLElement && el !== document.body ? el : null
        }}
        // 닫힘 포커스는 직접 정한다. 작업 행으로 닫히면 되돌리지 않는다 — "수정" 으로 연 인라인 에디터·스레드 패널의 자동 포커스를
        // 빼앗지 않게. 그냥 닫거나(바깥 탭·ESC) 반응만 달았을 땐 연 버튼으로 되돌린다 — "메시지 작업" 버튼(A1)으로 연
        // 스크린리더 사용자가 제자리를 잃지 않게. 입력칸은 되돌리지 않는다(모바일 가상 키보드가 다시 튀어 오른다).
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          const el = returnFocus.current
          returnFocus.current = null
          if (ranAction.current) {
            ranAction.current = false
            return
          }
          if (el?.isConnected && !el.isContentEditable && !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
            el.focus({ preventScroll: true })
          }
        }}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" />
        <SheetTitle className="sr-only">메시지 작업</SheetTitle>
        <SheetDescription className="sr-only">{preview || '선택한 메시지'}</SheetDescription>
        {onReact && (
          <div className="border-b px-3 py-2">
            <div className="flex items-center justify-between">
              {QUICK_EMOJIS.map(emojiButton)}
              <button
                type="button"
                data-testid="message-action-react-more"
                aria-label="이모지 더 보기"
                aria-expanded={allEmojis}
                onClick={() => setAllEmojis((v) => !v)}
                className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground active:bg-accent"
              >
                <Plus className="size-5" />
              </button>
            </div>
            {allEmojis && (
              <div className="mt-1 grid max-h-48 grid-cols-7 justify-items-center overflow-y-auto">
                {PICKER_EMOJIS.map(emojiButton)}
              </div>
            )}
          </div>
        )}
        <div className="py-1">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              data-testid={`message-action-${a.key}`}
              onClick={() => run(a.onSelect, true)}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 px-4 text-left text-base active:bg-accent [&_svg]:size-5 [&_svg]:shrink-0',
                a.destructive ? 'text-destructive' : 'text-foreground [&_svg]:text-muted-foreground',
              )}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
