// 본문 이슈 키 링크(WP-1237) — 채팅·코멘트 본문에 평문으로 쓴 「WP-1201」을 그 이슈로 가는 링크로 그리고 미리보기를 보인다.
//  - 내가 속한(ADMIN 은 전체) 프로젝트(useVisibleProjectKeys)의 키만 링크 — 모르는·속하지 않은 프로젝트 키는 글자 그대로 둔다.
//  - 마우스: 링크에 올리면 호버 카드로 미리보기(키·상태·제목·담당자), 누르면 이슈로 이동.
//  - 터치(pointer: coarse): 호버가 없어 누르면 팝오버로 미리보기, 카드 전체가 이슈로 가는 링크다(채팅 앱 링크 카드와 같은 「카드 = 링크」).
//  - 미리보기는 열 때만 받는다(채팅 앱 링크 카드와 같은 캐시·같은 API) — 본문 키가 많아도 요청은 연 것만큼.
import { useQuery } from '@tanstack/react-query'
import { Ban } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { Link } from 'react-router-dom'

import { appLinkCardQuery, isAppLinkDenied } from '@/api/appLinks'
import { IssueCardBody } from '@/components/chat/AppLinkCard'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useVisibleProjectKeys } from '@/hooks/queries/useProjects'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
import { type AppLink } from '@/lib/appLinks'
import { issuePath } from '@/lib/appUrl'
import { HOVER_CLOSE_DELAY_MS, HOVER_OPEN_DELAY_MS } from '@/lib/hoverDelays'

const LINK_CLASS = 'text-primary underline underline-offset-2'

// 채팅 행 클릭(탭 툴바)·코멘트 행 처리와 겹치지 않게 위로 올리지 않는다 — 포털 안 클릭도 React 조상으로 올라간다(TextLink 와 같은 이유).
const stop = (e: MouseEvent) => e.stopPropagation()

/** 본문 이슈 키 하나. 볼 수 없는 프로젝트(또는 목록을 받기 전)면 글자 그대로. */
export function IssueKeyRef({ text, projectKey, number }: { text: string; projectKey: string; number: number }) {
  const visibleKeys = useVisibleProjectKeys()
  const isCoarse = useIsCoarsePointer()
  const [open, setOpen] = useState(false)
  if (!visibleKeys?.has(projectKey)) return <>{text}</>

  const link: AppLink = { kind: 'ISSUE', to: issuePath(projectKey, number), key: projectKey, number }
  const testId = `issue-key-ref-${projectKey}-${number}`

  if (isCoarse) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* 글자 링크 모양의 버튼 — 누르면 바로 이동하지 않고 미리보기를 연다(터치는 호버가 없다). */}
          <button type="button" className={LINK_CLASS} data-testid={testId} onClick={stop}>
            {text}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start" onClick={stop}>
          {open && <IssueKeyPreview link={link} testId={`${testId}-preview`} onOpenIssue={() => setOpen(false)} />}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={HOVER_OPEN_DELAY_MS} closeDelay={HOVER_CLOSE_DELAY_MS}>
      <HoverCardTrigger asChild>
        {/* 누르면 카드를 닫는다 — 채팅 패널이 그대로 붙어 있는 채 주소만 바뀌면 카드가 남는다. */}
        <Link
          to={link.to}
          className={LINK_CLASS}
          data-testid={testId}
          onClick={(e) => {
            stop(e)
            setOpen(false)
          }}
        >
          {text}
        </Link>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" className="w-72 p-0" onClick={stop}>
        {open && <IssueKeyPreview link={link} testId={`${testId}-preview`} />}
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * 미리보기 칸 — 열린 동안만 그려져 그때 카드를 받는다. 없거나 볼 수 없는 이슈(404·403)는 「이슈를 찾을 수 없어요」,
 * 일시 오류는 「미리보기를 불러오지 못했어요」. onOpenIssue 가 있으면(터치) 카드 전체가 이슈로 가는 링크이고, 누르면 팝오버를 닫는다
 * (같은 이슈 화면 안의 채팅이면 주소가 그대로라 팝오버가 남는다). 터치는 글자 링크가 이동하지 않으므로, 받는 중·오류일 때도
 * 「이슈 열기」 를 둬 이슈로 갈 길을 남긴다(마우스는 글자 링크를 누르면 된다).
 */
function IssueKeyPreview({ link, testId, onOpenIssue }: { link: AppLink; testId: string; onOpenIssue?: () => void }) {
  const { data, error } = useQuery(appLinkCardQuery(link))
  const openLink = onOpenIssue && (
    <Link
      to={link.to}
      data-testid={`${testId}-open`}
      onClick={onOpenIssue}
      className="shrink-0 text-xs text-primary underline underline-offset-2"
    >
      이슈 열기
    </Link>
  )
  if (error) {
    return (
      <div data-testid={testId} data-state={isAppLinkDenied(error) ? 'denied' : 'error'} className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
        <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="flex-1">{isAppLinkDenied(error) ? '이슈를 찾을 수 없어요' : '미리보기를 불러오지 못했어요'}</span>
        {openLink}
      </div>
    )
  }
  if (!data) {
    return (
      <div data-testid={testId} data-state="loading" className="relative h-[60px]">
        <div className="absolute inset-0 animate-pulse bg-muted/40" aria-hidden />
        {openLink && <div className="absolute right-3 bottom-2">{openLink}</div>}
      </div>
    )
  }
  // 받은 뒤 — 마우스는 칸 하나, 터치는 칸 전체가 이슈 링크. testid·상태는 두 모양이 같아 한 번만 둔다.
  const readyProps = { 'data-testid': testId, 'data-state': 'ready' } as const
  const body = (
    <div className="px-3 py-2">
      <IssueCardBody data={data} testId={testId} />
    </div>
  )
  return onOpenIssue ? (
    <Link
      {...readyProps}
      to={link.to}
      onClick={onOpenIssue}
      className="block rounded-md no-underline transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {body}
    </Link>
  ) : (
    <div {...readyProps}>{body}</div>
  )
}
