// 반응자 전체 보기 오버레이(WP-106) — 데스크톱은 Dialog, 모바일 터치 셸은 하단 Sheet. 내용은 ReactorsPanel 공용.
// 열린 대상은 MessageList 가 id 로 들고 최신 목록에서 찾아 넘긴다 — 반응이 모두 사라지면 message.reactions 가 비어 닫는다.
import { ReactorsPanel } from '@/components/chat/ReactorsPanel'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import type { MessageResponse } from '@/types/messaging'

export function ReactorsOverlay({
  message,
  initialEmoji,
  open,
  onClose,
  touch,
  currentUserId,
  meName,
}: {
  message: MessageResponse | undefined
  initialEmoji: string
  open: boolean
  onClose: () => void
  touch: boolean
  currentUserId: number
  meName: string
}) {
  const visible = open && !!message && message.reactions.length > 0
  const onOpenChange = (next: boolean) => {
    if (!next) onClose()
  }
  // 열 때마다 탭을 누른 이모지로 초기화 — key 로 패널을 새로 만든다.
  const panel = message && (
    <ReactorsPanel
      key={`${message.id}-${initialEmoji}`}
      message={message}
      initialEmoji={initialEmoji}
      currentUserId={currentUserId}
      meName={meName}
    />
  )
  if (touch) {
    return (
      <Sheet open={visible} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          data-testid="reactors-sheet"
          className="max-h-[80dvh] gap-2 rounded-t-2xl px-4 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" />
          <SheetTitle>반응</SheetTitle>
          <SheetDescription className="sr-only">이 메시지에 반응한 사람</SheetDescription>
          {panel}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Dialog open={visible} onOpenChange={onOpenChange}>
      <DialogContent data-testid="reactors-dialog" className="max-w-sm gap-3">
        <DialogTitle>반응</DialogTitle>
        <DialogDescription className="sr-only">이 메시지에 반응한 사람</DialogDescription>
        {panel}
      </DialogContent>
    </Dialog>
  )
}
