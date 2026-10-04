// 터치 기기 공용 행 ⋯ 메뉴(WP-237) — hover 로만 드러나던 행 액션을 손가락으로도 쓰게 한다.
// 왜: pointer: coarse 기기엔 hover 가 없어 액션에 닿을 길이 없었다. ⋯ 하나(44px)로 모으고,
// 폭 <1024 는 모바일 액션 시트, ≥1024(터치 태블릿)는 드롭다운으로 연다 — 화면마다 따로 구현하던 것을 한곳에 모았다.
// 이 컴포넌트는 폭에 따라 시트/드롭다운으로 분기만 한다 — 호출 측이 터치(coarse·모바일 폭)일 때만 렌더하고,
// 마우스 데스크톱은 기존 hover 아이콘을 그대로 그린다.
import { MoreHorizontal } from 'lucide-react'
import { type SyntheticEvent, useState } from 'react'

import { MobileActionSheet, type MobileSheetAction } from '@/components/mobile/MobileActionSheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'

interface Props {
  /** 시트 제목·기본 트리거 라벨에 쓰는 대상 이름. */
  title: string
  /** ⋯ 트리거 testid. */
  testId: string
  actions: MobileSheetAction[]
  /** 호출부별 마진·크기 조정(cn 병합) — 예: 행 높이를 키우지 않도록 음수 세로 마진. */
  triggerClassName?: string
  /** 휴대폰 액션 시트 testid(MobileActionSheet 기본값 사용 시 생략). */
  sheetTestId?: string
  /** 드롭다운 항목 testid. 기본 `row-action-${key}`. */
  itemTestId?: (key: string) => string
  /** 트리거 접근성 라벨. 기본 `${title} 더보기`. */
  ariaLabel?: string
  /**
   * 트리거·메뉴의 클릭/포인터/키 이벤트가 React 트리로 부모 행까지 버블링되지 않게 막는다.
   * 왜: 행 자체가 DnD 리스너(onPointerDown/onKeyDown)를 가진 경우(노트 트리) 메뉴 조작이 드래그로 오인되지 않게.
   */
  isolateEvents?: boolean
}

const stop = (e: SyntheticEvent) => e.stopPropagation()

/**
 * 44px 터치 행 트리거 공용 클래스 — 이 메뉴와, 공유 시트를 따로 여는 휴대폰 행 ⋮(DrivePage)가 같은 모양을 쓴다.
 * 행 높이는 호출 측이 함께 키우거나(pointer-coarse:min-h-11) 음수 마진으로 흡수한다.
 */
export const TOUCH_ROW_TRIGGER =
  'flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent'

/** ⋯ 트리거 + (모바일 폭) 액션 시트 / (태블릿 폭) 드롭다운. 호출 측이 터치일 때만 렌더한다. */
export function TouchRowActionsMenu({
  title,
  testId,
  actions,
  triggerClassName,
  sheetTestId,
  itemTestId = (key) => `row-action-${key}`,
  ariaLabel = `${title} 더보기`,
  isolateEvents = false,
}: Props) {
  const isMobile = useIsMobile()
  const [sheetOpen, setSheetOpen] = useState(false)
  const triggerClass = cn(TOUCH_ROW_TRIGGER, triggerClassName)
  const icon = <MoreHorizontal className="size-5" aria-hidden />

  const content = isMobile ? (
    <>
      <button
        type="button"
        data-testid={testId}
        aria-label={ariaLabel}
        onClick={() => setSheetOpen(true)}
        className={triggerClass}
      >
        {icon}
      </button>
      <MobileActionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={title}
        actions={actions}
        testId={sheetTestId}
      />
    </>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-testid={testId} aria-label={ariaLabel} className={triggerClass}>
          {icon}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        // 터치 기기라 트리거로 포커스를 되돌릴 이유가 없다 — 항목이 연 다이얼로그·인라인 편집기의 포커스를 빼앗지 않게 막는다.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.key}
            data-testid={itemTestId(a.key)}
            variant={a.destructive ? 'destructive' : 'default'}
            disabled={a.disabled}
            onSelect={a.onSelect}
          >
            {a.icon}
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (!isolateEvents) return content
  // display: contents 래퍼 — 레이아웃엔 영향 없이 React 이벤트 버블링만 여기서 끊는다(포털 콘텐츠도 React 트리상 자식이라 함께 막힌다).
  return (
    <span className="contents" onClick={stop} onPointerDown={stop} onKeyDown={stop}>
      {content}
    </span>
  )
}
