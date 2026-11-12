// 채팅 본문의 우리 앱 링크 카드(WP-896, 시안 A) — 이슈·노트·드라이브 파일·폴더(WP-1536) 링크 아래에 보는 사람 권한으로 그 순간 채운 정보를 보인다.
// 카드 전체가 앱 안 이동 링크다(본문 URL 은 지금처럼 새 탭 — 가는 곳이 앱 밖 화면(/s/… 등)이면 카드도 새 탭, WP-1474). 볼 수 없거나 없는 대상은
// 정보 없이 점선 자리에 「볼 수 없는 …」만 둔다(만료된 공유 링크의 410 은 「만료된 공유 링크」).
// 드라이브 공유 링크(/s/sl_…, WP-1474)는 보는 사람이 공간 구성원이면 드라이브 파일 카드, 아니면 링크 상태(열림·비밀번호) 카드다.
import { Ban, CalendarDays, FileText, Folder, HardDrive, Lock, Mail, MessageSquare, SquareKanban } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import {
  type AppLinkCard as AppLinkCardData,
  appLinkErrorStatus,
  isAppLinkDenied as isDenied,
  shareCardDrivePath,
} from '@/api/appLinks'
import { FileTypeIcon } from '@/components/drive/FileTypeIcon'
import { useAppLinkCard } from '@/hooks/queries/useAppLinks'
import { APP_LINK_KIND_LABEL, type AppLink } from '@/lib/appLinks'
import { allDayLocalDate } from '@/lib/calendar'
import { formatDateKey, formatDateTimeMinute, formatFileSize, formatInstantMonthDay, formatListTime } from '@/lib/formatters'
import { priorityLabel } from '@/lib/issueGrouping'
import { mimeFromFilename } from '@/lib/mimeFromFilename'
import { IssueStatusBadge } from '@/pages/projects/components/IssueStatusBadge'
import { isOutsideSpaPath } from '@/sw/logic'
import type { IssueStatus } from '@/types/issue'

const CARD_CLASS = 'block w-full min-w-0 rounded-lg border px-3 py-2'

/**
 * 카드 1장. testId 접미사는 메시지 id·본문 순서. testIdPrefix — 메시지가 아닌 글(이슈 댓글, WP-1235)은 다른 접두를 써
 * 같은 화면의 메시지 카드 testid 와 겹치지 않게 한다.
 */
export function AppLinkCard({
  messageId,
  index,
  link,
  testIdPrefix = 'app-link',
}: {
  messageId: number
  index: number
  link: AppLink
  testIdPrefix?: string
}) {
  const testId = `${testIdPrefix}-${messageId}-${index}`
  const { data, error } = useAppLinkCard(link)

  // 일시 오류로 끝내 못 받았으면 카드 없이 둔다 — 「볼 수 없는 …」은 권한이 없거나 없는 대상일 때만(본문 링크는 그대로 남는다).
  if (error && !isDenied(error)) return null
  if (error) {
    // 410 은 만료·폐기·없는 공유 링크(WP-1474) — 열 곳이 없다는 것만 알리고, 그 밖(404·403)은 볼 수 없는 대상이다.
    const expired = appLinkErrorStatus(error) === 410
    return (
      <div
        data-testid={testId}
        data-state={expired ? 'expired' : 'denied'}
        className={`${CARD_CLASS} flex items-center gap-1.5 border-dashed text-xs text-muted-foreground`}
      >
        <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {expired ? '만료된 공유 링크입니다' : `볼 수 없는 ${APP_LINK_KIND_LABEL[link.kind]}입니다`}
      </div>
    )
  }
  // 받는 동안은 같은 높이의 빈 자리 — 받은 뒤 카드가 들어서며 목록이 덜 밀리게.
  if (!data) {
    return <div data-testid={testId} data-state="loading" className={`${CARD_CLASS} h-[60px] animate-pulse bg-muted/40`} />
  }
  const to = appLinkCardTo(link, data)
  // <a>·<Link> 공통 속성 — 다른 건 요소와 href/to 뿐이다.
  const props = {
    'data-testid': testId,
    'data-state': 'ready',
    // 채팅 행 클릭·탭 툴바와 겹치지 않게 위로 올리지 않는다(TextLink 와 같다).
    onClick: (e: MouseEvent) => e.stopPropagation(),
    className: `${CARD_CLASS} bg-card text-card-foreground no-underline transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`,
  }
  const body = <CardBody data={data} testId={testId} />
  // 가는 곳이 앱 밖 화면(서비스 워커가 서버로 보내는 /s/… 등, WP-1474)이면 앱 안 이동이 아니라 새 탭 — 본문 URL 과 같다.
  return isOutsideSpaPath(to) ? (
    <a href={to} target="_blank" rel="noopener noreferrer" {...props}>
      {body}
    </a>
  ) : (
    <Link to={to} {...props}>
      {body}
    </Link>
  )
}

/**
 * 보내기 전 미리보기(WP-1235) — 받는 쪽이 볼 카드와 같은 모양이되 이동 링크가 아니다(대화상자 안에서 눌러 화면을 떠나지 않게).
 * 카드를 받는 동안·받지 못했을 때는 fallback(대상 이름으로 그린 자리)을 보인다 — 보내는 사람은 이미 그 대상을 보고 있다.
 */
export function AppLinkCardPreview({ link, testId, fallback }: { link: AppLink; testId: string; fallback: ReactNode }) {
  const { data } = useAppLinkCard(link)
  if (!data) return <>{fallback}</>
  return (
    <div data-testid={testId} data-state="ready" className={`${CARD_CLASS} bg-card text-card-foreground`}>
      <CardBody data={data} testId={testId} />
    </div>
  )
}

/**
 * 카드를 누르면 갈 앱 안 경로.
 *   - 이슈 코멘트 링크면 그 코멘트로(#comment-<id>, WP-1236)
 *   - 공유 링크인데 보는 사람이 공간 구성원이면 드라이브의 그 파일 미리보기로(WP-1474, 노트 칩과 같은 shareCardDrivePath) — 공유 링크
 *     화면을 거치지 않게. 그 밖(링크로 열 수 있음·비밀번호)은 공유 링크 화면(/s/…) 그대로 — 앱 밖이라 카드가 새 탭으로 연다(위)
 */
function appLinkCardTo(link: AppLink, data: AppLinkCardData): string {
  if (link.kind === 'ISSUE' && link.fragment) return `${link.to}${link.fragment}`
  return shareCardDrivePath(data) ?? link.to
}

function CardBody({ data, testId }: { data: AppLinkCardData; testId: string }) {
  switch (data.kind) {
    case 'ISSUE':
      return <IssueCardBody data={data} testId={testId} />
    case 'PAGE':
      return (
        <TitledCardBody icon={<FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />} head={withPart('노트', data.spaceName)} data={data} testId={testId} />
      )
    case 'MESSAGE': {
      // 채널은 #이름, DM 은 상대 이름 — 대화 목록과 같은 표기. 본문 앞부분은 따옴표 없이 제목 자리에 둔다.
      const where = data.channelName ? (data.channelKind === 'DM' ? data.channelName : `#${data.channelName}`) : undefined
      const meta = [data.authorName, data.sentAt ? formatListTime(data.sentAt) : ''].filter(Boolean).join(' · ')
      return (
        <TitledCardBody icon={<MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />} head={withPart('메시지', where)} data={data} testId={testId} meta={meta} />
      )
    }
    case 'EVENT': {
      // 종일 일정은 날짜만(시각 00:00 은 뜻이 없다) — 캘린더와 같은 규칙(allDayLocalDate)으로 의도한 날짜를 읽는다(동기화 일정은 UTC 자정 저장).
      // 시작만 보인다(끝은 상세에서).
      const when = data.startAt
        ? data.allDay
          ? `${formatDateKey(allDayLocalDate(data.startAt))} 종일`
          : formatDateTimeMinute(data.startAt)
        : ''
      return (
        <TitledCardBody icon={<CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />} head="일정" data={data} testId={testId} meta={when} />
      )
    }
    case 'MAIL':
      return (
        <TitledCardBody
          icon={<Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          head={withPart('메일', data.authorName)}
          data={data}
          testId={testId}
          meta={data.sentAt ? formatDateTimeMinute(data.sentAt) : ''}
        />
      )
    case 'FILE':
      return <FileCardBody data={data} testId={testId} />
    case 'FOLDER':
      // 폴더 아이콘 + 폴더 이름, 둘째 줄에 공간 이름(WP-1536) — 드라이브 목록의 폴더 아이콘과 같은 모양.
      return <IconCardBody icon={<Folder className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />} head="폴더" title={data.title} meta={data.spaceName} testId={testId} />
    case 'DRIVE_SPACE':
      // 공간 첫 화면 링크(WP-1536) — 제목이 공간 이름이라 덧줄이 없다.
      return <IconCardBody icon={<HardDrive className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />} head="드라이브" title={data.title} testId={testId} />
    case 'SHARE':
      return <ShareCardBody data={data} testId={testId} />
  }
}

/** 「종류 · 덧말」 머리글 — 덧말이 없으면 종류만. */
function withPart(kind: string, part: string | undefined): string {
  return part ? `${kind} · ${part}` : kind
}

/** 아이콘·머리글 → 제목(두 줄) → 덧줄 — 노트·메시지·일정·메일 카드가 같은 모양을 쓴다. */
function TitledCardBody({
  icon,
  head,
  data,
  testId,
  meta,
}: {
  icon: ReactNode
  head: string
  data: AppLinkCardData
  testId: string
  meta?: string
}) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="truncate">{head}</span>
      </div>
      <div className="mt-0.5 line-clamp-2 font-semibold text-primary [overflow-wrap:anywhere]" data-testid={`${testId}-title`}>
        {data.title}
      </div>
      {meta && (
        <div className="mt-0.5 truncate text-xs text-muted-foreground" data-testid={`${testId}-meta`}>
          {meta}
        </div>
      )}
    </>
  )
}

/** 큰 아이콘 + 머리글·제목(·덧줄) — 드라이브 파일·폴더·공간 카드(WP-1536)와 공유 링크 카드(WP-1474)가 같은 모양을 쓴다. */
function IconCardBody({ icon, head, title, meta, testId }: { icon: ReactNode; head: string; title: string; meta?: string; testId: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {icon}
      <div className="min-w-0">
        <div className="truncate text-xs text-muted-foreground">{head}</div>
        <div className="truncate font-semibold text-primary" data-testid={`${testId}-title`}>
          {title}
        </div>
        {meta && (
          <div className="truncate text-xs text-muted-foreground" data-testid={`${testId}-meta`}>
            {meta}
          </div>
        )}
      </div>
    </div>
  )
}

/** 파일 종류 아이콘 — 서버가 준 mime, 없으면 이름의 확장자로 고른다. */
function fileIcon(mimeType: string | undefined, name: string): ReactNode {
  return <FileTypeIcon mimeType={mimeType ?? mimeFromFilename(name) ?? 'application/octet-stream'} className="h-5 w-5" />
}

function FileCardBody({ data, testId }: { data: AppLinkCardData; testId: string }) {
  return <IconCardBody icon={fileIcon(undefined, data.title)} head="파일" title={data.title} testId={testId} />
}

/**
 * 공유 링크 카드 본문(WP-1474) — 만료·폐기·없는 링크는 410 오류라 카드 밖에서 점선 자리로 그린다.
 *   - MEMBER: 공간 구성원 — 드라이브 파일 카드처럼 「파일 · 공간」 + 이름
 *   - OPEN: 링크로 열 수 있음 — 「공유 링크 · 만료일까지」 + 이름 + 「종류 · 크기」
 *   - PASSWORD: 비밀번호 링크 — 이름·크기·종류를 받지 않으므로 자물쇠와 서버가 준 고정 제목만
 * 공유한 사람 이름은 어디에도 넣지 않는다.
 */
function ShareCardBody({ data, testId }: { data: AppLinkCardData; testId: string }) {
  if (data.shareState === 'MEMBER') {
    return <IconCardBody icon={fileIcon(data.mimeType, data.title)} head={withPart('파일', data.spaceName)} title={data.title} testId={testId} />
  }
  if (data.shareState === 'OPEN') {
    const until = formatInstantMonthDay(data.expiresAt)
    const meta = [data.typeLabel, data.sizeBytes != null ? formatFileSize(data.sizeBytes) : ''].filter(Boolean).join(' · ')
    return (
      <IconCardBody
        icon={fileIcon(data.mimeType, data.title)}
        head={withPart('공유 링크', until ? `${until}까지` : undefined)}
        title={data.title}
        meta={meta}
        testId={testId}
      />
    )
  }
  return (
    <IconCardBody icon={<Lock className="h-5 w-5 shrink-0 text-primary" aria-hidden />} head="공유 링크" title={data.title} testId={testId} />
  )
}

/** 이슈 카드 칸(키·상태·제목·담당자·우선순위) — 채팅 앱 링크 카드와 본문 이슈 키 미리보기(WP-1237)가 같은 모양을 쓴다. */
export function IssueCardBody({ data, testId }: { data: AppLinkCardData; testId: string }) {
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
