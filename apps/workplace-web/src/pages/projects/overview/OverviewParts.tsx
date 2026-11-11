// 프로젝트 개요(WP-1478) 위젯 공통 조각 — 개요 링크, 사람 아바타, 카드 머리줄(제목·숫자·오른쪽 링크)과 이름·막대·숫자 한 줄.
// 열린 이슈·작업량·에픽이 같은 막대 줄을 써 줄 높이·글자·막대 모양이 갈라지지 않게 한다.
import { Link, type LinkProps } from 'react-router-dom'

import { UserAvatar } from '@/components/users/UserAvatar'
import { cn } from '@/lib/utils'
import type { ProjectOverviewUser } from '@/types/projectOverview'

import { FROM_OVERVIEW_STATE } from '../tabs/projectTabs'
import { barPct } from './overviewModel'

/**
 * 개요에서 나가는 링크 — 개요 표시(FROM_OVERVIEW_STATE)를 싣는 곳은 여기 한 곳뿐이다.
 * 이슈 탭으로 가면 주소의 조건은 따르되 이슈 탭의 조건 기억(WP-1035)은 바꾸지 않는다(useRememberedIssueQuery).
 * 이슈 상세·버전 상세로 가는 링크에도 실리지만 그 화면들은 읽지 않는다.
 */
export function OverviewIssueLink(props: Omit<LinkProps, 'state'>) {
  return <Link {...props} state={FROM_OVERVIEW_STATE} />
}

/**
 * 개요의 사람 아바타 — 이미지는 앱 전체 아바타 주소 표(AvatarsProvider)가 id 로 찾는다(다른 화면과 같은 길).
 * AI 는 AI 표식, 정지·비활성 계정(active false)은 회색·점선(WP-1080). 살펴볼 이슈·작업량이 같은 매핑을 쓴다.
 */
export function OverviewAvatar({ user, ...rest }: { user: ProjectOverviewUser; ring?: boolean; decorative?: boolean }) {
  return (
    <UserAvatar
      user={{ id: user.id, name: user.name, username: user.name }}
      size="xs"
      agent={user.kind === 'AGENT'}
      inactive={!user.active}
      {...rest}
    />
  )
}

/** 카드 머리줄 — 「열린 이슈 162」처럼 제목 옆 흐린 보조 글, 오른쪽 끝 링크(있을 때). */
export function WidgetHeader({
  title,
  aside,
  link,
}: {
  title: string
  aside?: React.ReactNode
  link?: { label: string; href: string; testId?: string }
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="flex min-w-0 items-baseline gap-2 text-sm font-semibold">
        {title}
        {aside != null && <span className="truncate text-xs font-normal text-muted-foreground">{aside}</span>}
      </h2>
      {link && (
        <OverviewIssueLink to={link.href} className="shrink-0 text-xs font-medium text-primary hover:underline" data-testid={link.testId}>
          {link.label}
        </OverviewIssueLink>
      )}
    </div>
  )
}

/**
 * 이름 · 막대 · 숫자 한 줄. href 가 있으면 줄 전체가 링크(그 조건의 이슈 탭). 막대 색은 토큰 클래스로 받는다.
 * leading 은 이름 앞 아바타 등.
 */
export function BarRow({
  label,
  value,
  max,
  barClass,
  href,
  leading,
  valueText,
  testId,
}: {
  label: React.ReactNode
  value: number
  max: number
  barClass: string
  href?: string
  leading?: React.ReactNode
  /** 오른쪽 숫자 대신 보일 글(에픽의 「6 / 9」 등). */
  valueText?: string
  testId?: string
}) {
  const body = (
    <>
      <span className="flex w-32 min-w-0 shrink-0 items-center gap-2 sm:w-40">
        {leading}
        <span className="truncate">{label}</span>
      </span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn('block h-full rounded-full', barClass)} style={{ width: `${barPct(value, max)}%` }} />
      </span>
      <span className="w-12 shrink-0 text-right tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>
        {valueText ?? value}
      </span>
    </>
  )
  const cls = 'flex items-center gap-3 rounded px-1 py-1.5 text-sm'
  return href ? (
    <OverviewIssueLink to={href} className={cn(cls, 'hover:bg-muted/50')} data-testid={testId}>
      {body}
    </OverviewIssueLink>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  )
}

/** 위젯 안 빈 상태 한 줄 — 카드 높이를 지키며 가운데 흐린 글. */
export function WidgetEmpty({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <p className="flex flex-1 items-center justify-center py-8 text-center text-sm text-muted-foreground" data-testid={testId}>
      {children}
    </p>
  )
}
