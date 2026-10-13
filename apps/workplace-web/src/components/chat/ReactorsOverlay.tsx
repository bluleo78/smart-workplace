// 반응자 전체 보기 오버레이(WP-106) — 데스크톱은 Dialog, 모바일 터치 셸은 하단 Sheet. 내용은 ReactorsPanel 공용.
// 열린 대상은 MessageList 가 id 로 들고 최신 목록에서 찾아 넘긴다 — 반응이 모두 사라지면 MessageList 가 open 을 내려 닫는다.
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
  // 반응이 모두 사라졌을 때 닫는 일은 MessageList 의 render-time 닫기가 맡는다 — 여기선 대상 메시지가 목록에 있는지만 본다.
  const visible = open && !!message
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
          // 아래 여백은 안전영역과 최소 0.75rem 중 큰 값 — 안전영역이 0 인 기기에서 마지막 행이 시트 가장자리에 붙어 잘려 보이던 문제.
          // 시트는 flex 열이라 목록(ReactorsPanel)이 남는 높이를 받아 스크롤한다(max-h 를 넘지 않음).
          className="max-h-[80dvh] gap-2 rounded-t-2xl px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
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
      <DialogContent data-testid="reactors-dialog" className="gap-3 sm:max-w-sm">
        <DialogTitle>반응</DialogTitle>
        <DialogDescription className="sr-only">이 메시지에 반응한 사람</DialogDescription>
        {panel}
      </DialogContent>
    </Dialog>
  )
}
