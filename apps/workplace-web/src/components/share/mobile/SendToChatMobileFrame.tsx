// 「채팅·이슈로 보내기」 휴대폰 전체 화면(WP-1235) — 이슈 만들기 시트(MobileIssueCreateSheet)와 같은 모양: [취소 · 제목 · 보내기] 머리,
// 높이 = 보이는 뷰포트(--vvh)·위치 = --vv-top(키보드가 열려도 머리가 가려지지 않게). 본문(받는 곳 고르기·쓰기)은 대화상자가 채운다.
import { Dialog as DialogPrimitive } from 'radix-ui'
import { type ReactNode, useState } from 'react'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useSheetHistory } from '@/hooks/useSheetHistory'

/**
 * 휴대폰 전체 화면 껍데기 — 시스템 뒤로 가기로 닫히게 히스토리 표식을 둔다(데스크톱 대화상자에는 두지 않는다).
 * 받는 곳을 골랐거나 말을 썼으면(hasContent) 뒤로 가기로 바로 닫지 않고 버림 확인을 띄운다 — 이슈 만들기 시트(onBlockedBack)와 같다.
 */
export function SendToChatMobileFrame({ title, onClose, hasContent, canSend, sending, onSend, children }: {
  title: string
  onClose: () => void
  hasContent: boolean
  canSend: boolean
  sending: boolean
  onSend: () => void
  children: ReactNode
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  useSheetHistory({ historyKey: 'sendToChat', open: true, hasContent, onClose, onBlockedBack: () => setConfirmDiscard(true) })
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        {/* 원시 Content — index.css 의 [data-slot=dialog-content] 키보드 규칙(가운데 정렬·max-height)을 피한다.
            z-[80] — AI 시트(z-[60]) 안에서 연 뷰어에서 불러도 그 위에 뜨게(공유 시트 aboveAiSheet 와 같은 층). */}
        <DialogPrimitive.Content
          data-testid="send-to-chat-dialog"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-x-0 top-[var(--vv-top,0px)] z-[80] flex h-[var(--vvh,100dvh)] flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none [:root[data-keyboard-open]_&]:pb-0"
        >
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4">
            <Button type="button" variant="ghost" className="-ml-3 h-11 px-3" onClick={onClose} data-testid="send-to-chat-cancel">
              취소
            </Button>
            <DialogPrimitive.Title className="truncate text-[17px] font-semibold">{title}</DialogPrimitive.Title>
            <Button type="button" className="h-9 px-4" disabled={!canSend || sending} onClick={onSend} data-testid="send-to-chat-submit">
              {sending ? '보내는 중…' : '보내기'}
            </Button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>

      {/* 버림 확인 — 전체 화면(z-[80]) 위에 뜨게 같은 층으로 올린다(뒤에 열린 포털이라 위). 딤은 data-ai-confirm 표식으로 index.css 가 함께 올린다. */}
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent data-ai-confirm className="z-[80]" data-testid="send-to-chat-discard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>보내지 않고 닫을까요?</AlertDialogTitle>
            <AlertDialogDescription>고른 받는 곳과 함께 보낼 말이 사라집니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="send-to-chat-discard-keep">계속 쓰기</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="send-to-chat-discard-confirm"
              onClick={() => {
                setConfirmDiscard(false)
                onClose()
              }}
            >
              버리기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogPrimitive.Root>
  )
}
