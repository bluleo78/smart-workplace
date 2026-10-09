import { Sparkles } from 'lucide-react'
import { type ComponentProps, useId, useRef, useState } from 'react'

import { AiLabel } from '@/components/ai/AiLabel'
import { MOBILE_SHEET_ROW, MobileSheetShell } from '@/components/mobile/MobileSheetShell'
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { avatarInitials } from '@/lib/avatarColor'
import { type PresencePerson, presenceStyle, splitVisible } from '@/lib/collab/presence'
import { cn } from '@/lib/utils'

/** 헤더에 펼쳐 보이는 최대 아바타 수(스펙 §7.1 데스크톱 3 · §7.2 모바일 1) — 나머지는 "+N". */
const DESKTOP_MAX = 3
const MOBILE_MAX = 1

/** 목록 행 공통 모양(데스크톱 팝오버). 모바일은 MOBILE_SHEET_ROW(44px) 를 덧씌운다. */
const ROW = 'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm'

/**
 * 접속자 아바타 — 사람 색 바탕(bg-presence = 이 요소의 --presence-color, Task 2 @theme inline) + 이니셜. AI 작성 중이면 우하단 ✦ 배지(AI 마커 토큰 — 사람 색 아님, 판정 4).
 * 배지(10px·링 1px)는 우하단 모서리에서 4px 밖으로 걸쳐 둔다(-right-1 -bottom-1) — 안쪽(right-0, 12px·링 2px)에 두면 24px 아바타의
 *   이니셜 오른쪽 아래를 가렸다(Task 11 디자인 리뷰). 4px 만 내밀어 겹친 다음 아바타·"+N" 의 글자에는 닿지 않는다.
 * 다크에선 ai-accent 위 흰 아이콘이 3:1 미달이라 옅은 바탕 + ai-accent 아이콘으로 바꾼다(wiki-editor.css ✦ 태그와 같은 이유).
 */
export function PresenceAvatar({ person, className, ...rest }: { person: PresencePerson } & ComponentProps<typeof Avatar>) {
  return (
    <Avatar
      size="sm"
      data-testid={`wiki-presence-avatar-${person.userId}`}
      data-ai={person.aiWriting ? 'true' : undefined}
      className={cn('overflow-visible', className)}
      style={presenceStyle(person.userId)}
      {...rest}
    >
      <AvatarFallback className="bg-presence text-xs font-semibold text-presence-foreground">
        {avatarInitials(person.name)}
      </AvatarFallback>
      {person.aiWriting && (
        <AvatarBadge
          data-testid={`wiki-presence-ai-${person.userId}`}
          className="-right-1 -bottom-1 bg-ai-accent text-ai-accent-foreground ring-1 group-data-[size=sm]/avatar:size-2.5 group-data-[size=sm]/avatar:[&>svg]:block group-data-[size=sm]/avatar:[&>svg]:size-2 dark:bg-ai-accent-subtle dark:text-ai-accent"
        >
          <Sparkles aria-hidden="true" />
        </AvatarBadge>
      )}
    </Avatar>
  )
}

/**
 * 접속자 목록(팝오버·바텀시트 공용) — 이름 + 상태("✦ AI 작성 중" / 편집 중이면 없음 / "보는 중", collab-states 시안).
 * 커서나 AI 표식이 있어 갈 곳이 있는 사람만 버튼(이름 클릭 → 그 커서로 스크롤). 긴 이름은 말줄임 + title 로 전체 이름.
 */
export function WikiPresenceList({
  people,
  onSelect,
  rowClassName,
}: {
  people: PresencePerson[]
  onSelect?: (p: PresencePerson) => void
  rowClassName?: string
}) {
  return (
    // role="list": list-style 을 지운 ul 은 Safari VoiceOver 가 목록으로 읽지 않는다.
    <ul data-testid="wiki-presence-list" role="list" className="flex flex-col">
      {people.map((p) => {
        const canJump = onSelect != null && (p.editing || p.aiWriting)
        const body = (
          <>
            <PresenceAvatar person={p} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-left" title={p.name} data-testid="wiki-presence-name">
              {p.name}
            </span>
            {p.aiWriting ? (
              <AiLabel className="shrink-0">AI 작성 중</AiLabel>
            ) : p.editing ? null : (
              <span className="shrink-0 text-xs text-muted-foreground">보는 중</span>
            )}
          </>
        )
        return (
          <li key={p.userId} data-testid={`wiki-presence-row-${p.userId}`}>
            {canJump ? (
              <button
                type="button"
                onClick={() => onSelect(p)}
                className={cn(ROW, 'outline-none hover:bg-accent focus-visible:bg-accent', rowClassName)}
              >
                {body}
              </button>
            ) : (
              <div className={cn(ROW, rowClassName)}>{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** 헤더 접속자 표시의 입력 — 바깥(WikiPresence)과 안쪽(WikiPresenceTrigger)이 같은 모양을 쓴다. */
type WikiPresenceProps = {
  people: PresencePerson[]
  compact: boolean
  stale: boolean
  onJump?: (p: PresencePerson) => void
}

/**
 * 노트 헤더 접속자(WP-292, 스펙 §7.1·§7.2) — 다른 접속자가 없으면 아무것도 그리지 않는다.
 * - 데스크톱: 아바타 최대 3 + "+N"(각 아바타 hover 툴팁) → 클릭 시 팝오버 목록.
 * - 모바일: 아바타 1 + "+N"(44px 터치 영역) → 탭 시 바텀시트 목록. hover 가 없으므로 툴팁 대신 시트가 이름을 보인다.
 * - stale(끊긴 동안)이면 아바타 묶음을 흐리게 — 버튼 자체가 아니라 안쪽만 흐려 포커스 링 대비를 지킨다.
 */
export function WikiPresence({ people, compact, stale, onJump }: WikiPresenceProps) {
  if (people.length === 0) return null
  // 열림 상태는 안쪽(WikiPresenceTrigger)에 둔다 — 목록이 비면 안쪽이 내려가 열림이 함께 사라지고, 데스크톱↔모바일 전환은 key 로
  // 새로 시작한다. 바깥에 두면 연 채로 모두 나간 뒤 다음 사람이 들어오는 순간 누르지도 않은 팝오버·시트가 열린다.
  return <WikiPresenceTrigger key={compact ? 'compact' : 'wide'} people={people} compact={compact} stale={stale} onJump={onJump} />
}

/** 접속자가 있을 때의 헤더 버튼 + 목록(팝오버·바텀시트) — 열림 상태의 수명이 "접속자가 보이는 동안" 과 같다. */
function WikiPresenceTrigger({ people, compact, stale, onJump }: WikiPresenceProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const { shown, more } = splitVisible(people, compact ? MOBILE_MAX : DESKTOP_MAX)
  const title = `이 노트를 보고 있는 사람 ${people.length}`
  const select = onJump
    ? (p: PresencePerson) => {
        setOpen(false)
        onJump(p)
      }
    : undefined
  const stack = (
    <span className={cn('flex', stale && 'opacity-60')}>
      <AvatarGroup className="-space-x-1.5">
        {shown.map((p) =>
          compact ? (
            <PresenceAvatar key={p.userId} person={p} aria-hidden="true" />
          ) : (
            <Tooltip key={p.userId}>
              <TooltipTrigger asChild>
                <PresenceAvatar person={p} />
              </TooltipTrigger>
              <TooltipContent side="bottom">{p.aiWriting ? `${p.name} · AI 작성 중` : p.name}</TooltipContent>
            </Tooltip>
          ),
        )}
        {more > 0 && (
          // ms-1: 앞 아바타의 겹침(-space-x-1.5)·링이 "+N" 글자를 가리지 않게 숫자만 덜 겹친다(시각 검증에서 다크 링이 "+" 를 잘랐다).
          <AvatarGroupCount data-testid="wiki-presence-more" className="ms-1 text-xs">
            +{more}
          </AvatarGroupCount>
        )}
      </AvatarGroup>
    </span>
  )
  const triggerProps = {
    type: 'button' as const,
    'data-testid': 'wiki-presence',
    'data-stale': stale ? 'true' : undefined,
    'aria-label': `${title}명 — 목록 보기`,
  }

  if (!compact) {
    return (
      <TooltipProvider>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              {...triggerProps}
              className="flex shrink-0 items-center rounded-full p-0.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              {stack}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-1" data-testid="wiki-presence-popover" aria-labelledby={titleId}>
            <p id={titleId} className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">
              {title}
            </p>
            <WikiPresenceList people={people} onSelect={select} />
          </PopoverContent>
        </Popover>
      </TooltipProvider>
    )
  }
  return (
    <>
      <button
        {...triggerProps}
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex h-11 shrink-0 items-center rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {stack}
      </button>
      <MobileSheetShell
        open={open}
        onClose={() => {
          setOpen(false)
          // 닫으면 여는 버튼으로 포커스를 돌린다(공용 셸은 복귀를 막는 것이 기본). 닫힘이 반영돼 포커스 가둠이 풀린 다음 프레임에 옮긴다.
          requestAnimationFrame(() => triggerRef.current?.focus())
        }}
        title={title}
        description="이름을 누르면 그 사람의 커서 위치로 이동합니다"
        testId="wiki-presence-sheet"
      >
        <div className="overflow-y-auto pb-2">
          <WikiPresenceList people={people} onSelect={select} rowClassName={MOBILE_SHEET_ROW} />
        </div>
      </MobileSheetShell>
    </>
  )
}
