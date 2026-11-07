// 원시 Radix Dialog.Content 래퍼(WP-1432) — 휴대폰 전체 화면 시트가 닫히면 포커스를 연 요소로 돌려준다.
// 전체 화면 시트는 index.css 의 [data-slot=dialog-content] 휴대폰 규칙(가운데 정렬·max-height)을 피하려고 ui/DialogContent 대신
// 원시 Content 를 쓴다. 그런데 DialogTrigger 없이 상태(open)로 열면 Radix 는 닫을 때 비어 있는 triggerRef 로만 포커스를 돌려주고
// (모달은 FocusScope 의 자체 복원도 막는다) 포커스가 body 로 빠졌다. ui/DialogContent 가 쓰는 복원(useDialogFocusRestore +
// DialogOpenerProbe)을 그대로 붙여, 데스크톱 대화상자와 같은 기준으로 Radix 자신의 닫힘 포커스 훅(onCloseAutoFocus)에서 돌려준다.
import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'

import { DialogOpenerProbe, useDialogFocusRestore } from '@/hooks/useDialogFocusRestore'

/** 지금 열려 있는 대화상자(대화상자·확인창). 닫히는 중(퇴장 애니메이션, data-state=closed)인 것은 뺀다. */
const OPEN_DIALOGS = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'

/**
 * 돌려줄지 — 연 요소 밖에 다른 대화상자가 열려 있으면 돌려주지 않는다. 시트가 닫혀서가 아니라 폭 전환(휴대폰 ↔ 데스크톱)으로
 * 다른 모양의 대화상자로 바뀌며 언마운트된 경우, 새 대화상자가 가진 포커스를 그 뒤에 가려진 옛 단추로 끌어오지 않게 한다.
 * 시트를 다른 대화상자 안에서 열었으면(연 요소가 그 대화상자 안) 그대로 돌려준다. onCloseAutoFocus 시점에는 닫힌 시트 자신은 이미 DOM 에 없다.
 */
function noOtherDialogCovers(target: HTMLElement) {
  return Array.from(document.querySelectorAll(OPEN_DIALOGS)).every((dialog) => dialog.contains(target))
}

/** 원시 DialogPrimitive.Content 와 같은 props — 닫힐 때 연 요소로 포커스를 돌려주는 것만 더한다. */
export function RawSheetContent({ onOpenAutoFocus, onCloseAutoFocus, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  const focusRestore = useDialogFocusRestore(onOpenAutoFocus, onCloseAutoFocus, noOtherDialogCovers)
  return (
    <DialogPrimitive.Content {...props} onOpenAutoFocus={focusRestore.onOpenAutoFocus} onCloseAutoFocus={focusRestore.onCloseAutoFocus}>
      {/* 입력 칸 autoFocus 가 포커스를 옮기기 전에 연 요소를 잡는다(ui/DialogContent 와 같다). */}
      <DialogOpenerProbe onMount={focusRestore.captureOpener} />
      {children}
    </DialogPrimitive.Content>
  )
}
