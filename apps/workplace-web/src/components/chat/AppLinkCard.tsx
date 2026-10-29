// 채팅 본문의 우리 앱 링크 카드(WP-896, 시안 A) — 이슈·노트·드라이브 파일 링크 아래에 보는 사람 권한으로 그 순간 채운 정보를 보인다.
// 카드 전체가 앱 안 이동 링크다(본문 URL 은 지금처럼 새 탭). 볼 수 없거나 없는 대상은 정보 없이 점선 자리에 「볼 수 없는 …」만 둔다.
import { Ban, FileText, SquareKanban } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'

import { type AppLinkCard as AppLinkCardData, isAppLinkDenied as isDenied } from '@/api/appLinks'
import { FileTypeIcon } from '@/components/drive/FileTypeIcon'
import { useAppLinkCard } from '@/hooks/queries/useAppLinks'
import { APP_LINK_KIND_LABEL, type AppLink } from '@/lib/appLinks'
import { priorityLabel } from '@/lib/issueGrouping'
import { mimeFromFilename } from '@/lib/mimeFromFilename'
import { IssueStatusBadge } from '@/pages/projects/components/IssueStatusBadge'
import type { IssueStatus } from '@/types/issue'

const CARD_CLASS = 'block w-full min-w-0 rounded-lg border px-3 py-2'

/** 카드 1장. testId 접미사는 메시지 id·본문 순서. */
export function AppLinkCard({ messageId, index, link }: { messageId: number; index: number; link: AppLink }) {
  const testId = `app-link-${messageId}-${index}`
  const { data, error } = useAppLinkCard(link)

  // 일시 오류로 끝내 못 받았으면 카드 없이 둔다 — 「볼 수 없는 …」은 권한이 없거나 없는 대상일 때만(본문 링크는 그대로 남는다).
  if (error && !isDenied(error)) return null
  if (error) {
    return (
      <div
        data-testid={testId}
        data-state="denied"
        className={`${CARD_CLASS} flex items-center gap-1.5 border-dashed text-xs text-muted-foreground`}
      >
        <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden />
        볼 수 없는 {APP_LINK_KIND_LABEL[link.kind]}입니다
      </div>
    )
  }
  // 받는 동안은 같은 높이의 빈 자리 — 받은 뒤 카드가 들어서며 목록이 덜 밀리게.
  if (!data) {
    return <div data-testid={testId} data-state="loading" className={`${CARD_CLASS} h-[60px] animate-pulse bg-muted/40`} />
  }
  return (
    <Link
      to={link.to}
      data-testid={testId}
      data-state="ready"
      // 채팅 행 클릭·탭 툴바와 겹치지 않게 위로 올리지 않는다(TextLink 와 같다).
      onClick={(e: MouseEvent) => e.stopPropagation()}
      className={`${CARD_CLASS} bg-card text-card-foreground no-underline transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
    >
      <CardBody data={data} testId={testId} />
    </Link>
  )
}

function CardBody({ data, testId }: { data: AppLinkCardData; testId: string }) {
  if (data.kind === 'ISSUE') {
    const people = (data.assignees ?? []).map((a) => a.name).join(', ')
    const meta = [people, data.priority ? `우선순위 ${priorityLabel(data.priority)}` : ''].filter(Boolean).join(' · ')
    return (
      <>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <SquareKanban className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>이슈</span>
          <span className="font-mono text-foreground" data-testid={`${testId}-key`}>
            {data.issueKey}
          </span>
          {data.statusCategory && (
            <IssueStatusBadge status={data.statusCategory as IssueStatus} name={data.statusName} className="max-w-32" />
          )}
        </div>
        <div className="mt-0.5 line-clamp-2 font-semibold text-primary [overflow-wrap:anywhere]" data-testid={`${testId}-title`}>
          {data.title}
        </div>
        {meta && <div className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</div>}
      </>
    )
  }
  if (data.kind === 'PAGE') {
    return (
      <>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">노트{data.spaceName ? ` · ${data.spaceName}` : ''}</span>
        </div>
        <div className="mt-0.5 line-clamp-2 font-semibold text-primary [overflow-wrap:anywhere]" data-testid={`${testId}-title`}>
          {data.title}
        </div>
      </>
    )
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <FileTypeIcon mimeType={mimeFromFilename(data.title) ?? 'application/octet-stream'} className="h-5 w-5" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">파일</div>
        <div className="truncate font-semibold text-primary" data-testid={`${testId}-title`}>
          {data.title}
        </div>
      </div>
    </div>
  )
}
