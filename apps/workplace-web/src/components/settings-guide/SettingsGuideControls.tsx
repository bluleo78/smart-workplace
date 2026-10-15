// 설정 가이드를 여는 틀 — 넓은 본문의 sticky 열, 헤더 버튼, 좁은 데스크톱의 비모달 오른쪽 시트, 모바일 하단 시트(WP-399).
// 내용은 모두 SettingsGuidePanel 하나를 공유하고, 어느 틀을 쓸지는 SettingsPage 가 본문 폭(wide)·접힘·모바일로 정한다.
import { Info, XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { type Ref, type RefObject, useRef } from 'react'

import { MobileSheetShell } from '@/components/mobile/MobileSheetShell'
import { isKeyboardEditable } from '@/components/mobile/useVisualViewport'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { SettingsGuidePanel } from './SettingsGuidePanel'
import type { SettingsGuide } from './types'

const GUIDE_TITLE = '설정 가이드'
const GUIDE_DESCRIPTION = '이 설정 화면에서 알아두면 좋은 내용이에요.'
/** 열·데스크톱 시트 공용 제목 — 폼 섹션 제목(text-base semibold)보다 한 단계 낮춰 폼이 주인공으로 남게 한다. */
const guideTitleClass = 'text-sm leading-5 font-semibold'

/** 오른쪽 sticky 열 — 본문과 같은 면(배경·경계선 없음)이고 폼과는 간격으로만 구분한다. */
export function SettingsGuideAside({ guide, onHide }: { guide: SettingsGuide; onHide: () => void }) {
  return (
    <aside
      aria-label={GUIDE_TITLE}
      data-testid="settings-guide-aside"
      // self-start: flex 행 높이로 늘어나지 않아야 sticky 가 스크롤 컨테이너 상단에 붙는다.
      // pt-6: 본문 py-4 + 첫 섹션 pt-2 와 같아 열 머리가 첫 섹션 제목과 같은 높이에 선다.
      className="sticky top-0 w-[280px] shrink-0 self-start pt-6 pr-4 pb-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className={guideTitleClass}>{GUIDE_TITLE}</h2>
        <Button type="button" variant="ghost" size="xs" data-testid="settings-guide-hide" onClick={onHide}>
          숨기기
        </Button>
      </div>
      <SettingsGuidePanel guide={guide} />
    </aside>
  )
}

/** 헤더 「가이드」 버튼 — 데스크톱은 아이콘+텍스트, 모바일은 아이콘만(44px 터치 영역). */
export function SettingsGuideButton({
  mobile,
  expanded,
  controls,
  onClick,
  ref,
}: {
  mobile: boolean
  expanded: boolean
  /** 열리는 시트의 id — 시트가 있는 데스크톱에서만 넘긴다. */
  controls?: string
  onClick: () => void
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size={mobile ? 'icon' : 'sm'}
      data-testid="settings-guide-button"
      aria-label={GUIDE_TITLE}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className={cn(mobile && 'h-11 w-11 text-muted-foreground [&_svg]:size-5')}
    >
      <Info />
      {!mobile && '가이드'}
    </Button>
  )
}

/**
 * 좁은 데스크톱용 오른쪽 시트 — 비모달(modal=false)이라 오버레이·포커스 가둠이 없고 시트를 연 채 폼을 편집할 수 있다.
 * ui/sheet(뷰포트 fixed + Portal) 대신 Radix Dialog 프리미티브를 Portal 없이 그린다 — SettingsPage 가 본문 영역을 감싼
 * relative 상자 안에 absolute 로 두어, AI 옆 패널이 열려 있어도 그 왼쪽(본문 영역 안)에만 뜬다(패널 폭을 몰라도 됨).
 * 바깥 클릭·포커스 이동으로 닫히지 않게 막고(ESC·✕ 로만 닫음), 닫힐 때는 헤더 버튼으로 포커스를 돌린다(트리거가 Radix 밖이라 직접).
 * ESC 는 Radix 가 document 전체에서 받으므로, 포커스가 시트 밖 편집 요소에 있으면 무시한다(폼 입력 중 ESC 로 시트가 닫히고 포커스가 튀지 않게).
 */
export function SettingsGuideDesktopSheet({
  guide,
  open,
  id,
  onClose,
  returnFocusRef,
}: {
  guide: SettingsGuide
  open: boolean
  id: string
  onClose: () => void
  /** 닫힐 때 포커스를 돌려줄 요소(헤더 버튼). */
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
      <DialogPrimitive.Content
        id={id}
        data-testid="settings-guide-sheet"
        // z-30: 본문(sticky 등)보다 위, 토스트(z-40)·헤더(z-45)·오버레이(z-50)보다 아래.
        className="absolute inset-y-0 right-0 z-30 flex w-[320px] flex-col border-l bg-background shadow-lg data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-500"
        ref={contentRef}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          const active = document.activeElement
          if (active && !contentRef.current?.contains(active) && isKeyboardEditable(active)) e.preventDefault()
        }}
        onCloseAutoFocus={(e) => {
          const target = returnFocusRef.current
          if (target) {
            e.preventDefault()
            target.focus()
          }
        }}
      >
        <div className="flex items-center justify-between gap-2 p-4">
          <DialogPrimitive.Title className={guideTitleClass}>{GUIDE_TITLE}</DialogPrimitive.Title>
          {/* 클릭 영역 size-6(24px) — ui/sheet 닫기 버튼과 같은 규격(WCAG 2.5.8). */}
          <DialogPrimitive.Close className="flex size-6 items-center justify-center rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden">
            <XIcon className="size-4" />
            <span className="sr-only">닫기</span>
          </DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description className="sr-only">{GUIDE_DESCRIPTION}</DialogPrimitive.Description>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <SettingsGuidePanel guide={guide} onNavigate={onClose} />
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  )
}

/** 모바일 하단 시트 — 다른 모바일 시트와 같은 MobileSheetShell(바깥 탭·밀어 닫기) 동작을 따른다. */
export function SettingsGuideMobileSheet({ guide, open, onClose }: { guide: SettingsGuide; open: boolean; onClose: () => void }) {
  return (
    <MobileSheetShell open={open} onClose={onClose} title={GUIDE_TITLE} description={GUIDE_DESCRIPTION} testId="settings-guide-mobile-sheet">
      <div className="min-h-0 overflow-y-auto px-4 pb-4">
        <SettingsGuidePanel guide={guide} onNavigate={onClose} />
      </div>
    </MobileSheetShell>
  )
}
