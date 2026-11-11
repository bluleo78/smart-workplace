// 도움말 ⌄ 목록(WP-1505) — 브레드크럼 끝 ⌄ 를 누르면 브레드크럼 줄 아래로 펼쳐지는 팝오버.
// 위 「이 화면」은 지금 장의 절을 문서 순서·층만큼 들여써 보이고(지금 절 강조), 아래 「관련」은 본문이 가리키는 다른 절이다.
// 팝오버는 브레드크럼 줄 전체(PopoverAnchor)에 붙여 패널 폭만큼 펼친다(시안 mockup-help-menu.jpg).
import { ChevronDown } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'

import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { cn } from '@/lib/utils'

import type { HelpIndexChapter } from './helpBundle'
import { type HelpSectionRef, type HelpTarget, sectionName, sectionTree } from './helpNav'

/** 목록 한 칸 — 들여쓰기는 층(depth)마다 12px. 지금 절은 선택 배경·강조 글자. */
function MenuItem({ label, depth, current, onClick }: { label: string; depth: number; current: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="help-menu-item"
      aria-current={current ? 'true' : undefined}
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={cn(
        'block w-full truncate rounded-md py-1.5 pr-2 text-left text-sm transition-colors',
        current ? 'bg-selected font-medium text-primary' : 'text-foreground hover:bg-accent',
      )}
    >
      {label}
    </button>
  )
}

/** 묶음 머리(「이 화면」「관련」) — 작은 옅은 글자. */
function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">{children}</div>
}

export interface HelpSectionMenuProps {
  /** 지금 장(목차의 장 — 절 이름·층만 쓴다). */
  chapter: HelpIndexChapter
  /** 지금 보는 절 id. */
  currentId: string
  /** 「관련」 절(이미 보이는 장만 거른 것). 비면 묶음째 그리지 않는다. */
  related: HelpSectionRef[]
  /** 절을 골랐을 때 — 팝오버는 스스로 닫는다. */
  onSelect: (target: HelpTarget) => void
  /** 브레드크럼 줄 — 받은 ⌄ 단추(trigger)를 줄 끝에 넣어 그린다. 이 줄 전체가 팝오버의 기준(anchor)이 된다. */
  children: (trigger: ReactNode) => ReactNode
}

/** 브레드크럼 줄 + ⌄ + 펼친 목록. */
export function HelpSectionMenu({ chapter, currentId, related, onSelect, children }: HelpSectionMenuProps) {
  const [open, setOpen] = useState(false)
  const picked = useRef(false)
  const pick = (target: HelpTarget) => {
    picked.current = true
    setOpen(false)
    onSelect(target)
  }
  const trigger = (
    <PopoverTrigger
      data-testid="help-section-menu-toggle"
      aria-label="이 화면 도움말 목록"
      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
    </PopoverTrigger>
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="min-w-0">{children(trigger)}</div>
      </PopoverAnchor>
      {/* z-[70] — 휴대폰 전체 화면 도움말 시트(z-50 대화상자) 위에도 뜨게. 폭은 브레드크럼 줄(anchor) 폭. */}
      <PopoverContent
        data-testid="help-section-menu"
        align="start"
        collisionPadding={8}
        // 항목을 고르면 닫힐 때 ⌄ 로 포커스를 되돌리지 않는다 — 패널이 새 절 본문으로 포커스를 옮긴다(⌄ 는 다른 장이면 받는 동안 사라진다).
        onCloseAutoFocus={(e) => {
          if (picked.current) e.preventDefault()
          picked.current = false
        }}
        className="z-[70] max-h-[min(420px,60vh)] w-(--radix-popover-trigger-width) overflow-y-auto p-1.5"
      >
        <GroupLabel>이 화면</GroupLabel>
        {sectionTree(chapter).map(({ section, depth }) => (
          <MenuItem
            key={section.id}
            label={sectionName(section)}
            depth={depth}
            current={section.id === currentId}
            onClick={() => pick({ chapter: chapter.chapter, sectionId: section.id })}
          />
        ))}
        {related.length > 0 && (
          <>
            <div className="my-1.5 border-t" />
            <GroupLabel>관련</GroupLabel>
            {related.map((ref) => (
              <MenuItem
                key={ref.section.id}
                label={sectionName(ref.section)}
                depth={0}
                current={false}
                onClick={() => pick({ chapter: ref.chapter.chapter, sectionId: ref.section.id })}
              />
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
