"use client"

import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { preventDismissOnExtensionUi } from "@/lib/browserExtensionUi"
import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  // 다이얼로그가 열릴 때 포커스를 갖고 있던 요소(대개 트리거 버튼)를 기억해뒀다가
  // 닫힐 때 그 요소로 포커스를 되돌린다 — Radix 기본 동작(triggerRef.focus())은
  // `<DialogTrigger>` 를 쓰지 않고 커스텀 버튼 + `open` 상태로 여는 사용처(예:
  // EventDialog)에서 triggerRef 가 null 이라 무력화된다(#708).
  //
  // 캡처 시점은 useLayoutEffect(마운트 시 1회)가 아니라 onOpenAutoFocus 를 쓴다:
  // 이 컴포넌트(DialogContent 래퍼)는 부모가 `open` 여부와 무관하게 항상 JSX 트리에
  // 존재하므로(Presence 로 내부 DOM 만 열고 닫음) 래퍼의 useLayoutEffect 는 최초
  // 마운트 시 단 한 번만 실행돼 재오픈 시 캡처가 안 된다. onOpenAutoFocus 는 Radix
  // FocusScope 가 "다이얼로그 안으로 포커스를 옮기기 직전"에 매 open 마다 동기 호출하는
  // 콜백이라 정확한 시점에 매번 재캡처된다.
  const previouslyFocusedElementRef = React.useRef<HTMLElement | null>(null)

  // 사용처가 onOpenAutoFocus 를 직접 넘긴 경우 그 핸들러를 먼저 실행(순수 관찰이라
  // defaultPrevented 여부와 무관하게 항상 캡처).
  const handleOpenAutoFocus = React.useCallback(
    (event: Event) => {
      onOpenAutoFocus?.(event)
      const active = document.activeElement
      // document.body 는 유효한 복원 대상이 아니다(포커스가 이미 없던 상태).
      previouslyFocusedElementRef.current =
        active instanceof HTMLElement && active !== document.body ? active : null
    },
    [onOpenAutoFocus]
  )

  // 사용처가 onCloseAutoFocus 를 직접 넘긴 경우 그 핸들러가 우선하도록 병합하고,
  // 사용처가 이미 preventDefault() 로 포커스를 직접 처리했다면 기본 복원 로직을 건너뛴다.
  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event)
      const target = previouslyFocusedElementRef.current
      // 래퍼가 open 사이클을 넘어 유지되므로, 다음 open 에서 stale 복원을 막기 위해
      // 이번 close 에서 소비한 뒤 즉시 비운다.
      previouslyFocusedElementRef.current = null

      if (event.defaultPrevented) return

      // 복원 대상이 이미 DOM 에서 제거됐을 수 있으므로 isConnected 확인 후 focus.
      if (target && target.isConnected) {
        event.preventDefault()
        target.focus()
      }
    },
    [onCloseAutoFocus]
  )

  // 1Password 등 비밀번호 관리자가 body 에 주입한 자동완성 메뉴를 클릭하면 Radix 가 "바깥 클릭"으로 보고
  // 다이얼로그를 닫아 입력 중인 폼이 사라진다 — 확장 UI 상호작용은 닫힘 대상에서 제외한다(WP-96).
  const handleInteractOutside = React.useCallback(
    (event: Parameters<NonNullable<typeof onInteractOutside>>[0]) => {
      onInteractOutside?.(event)
      preventDismissOnExtensionUi(event)
    },
    [onInteractOutside]
  )

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        onInteractOutside={handleInteractOutside}
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 outline-none sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            // 클릭 영역을 size-6(24px)로 확장 — 아이콘 자체는 size-4 유지, WCAG 2.5.8 Target Size 충족(#706).
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 flex size-6 items-center justify-center rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">닫기</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
