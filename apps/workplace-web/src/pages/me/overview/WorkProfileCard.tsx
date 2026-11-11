// 업무 프로파일 카드(WP-1485) — 그 기간에 끝낸 이슈를 AI 가 분류한 결과(요약·주요 업무·자주 일한 영역·역량). 개요의 추이/마감 아래, 맡은 이슈 위 전체 폭.
// 보고서 원자료라 숫자·태그는 서버가 준 그대로 그린다. 분석 중(PENDING)이면 훅이 3초마다 다시 읽고, 「다시 분석」은 하루 상한(429)을 서버 문구로 알린다.
// 조회 실패는 카드 안에서만 다시 시도를 보인다 — 개요 전체를 막지 않는다.
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { LoadErrorState } from '@/components/LoadErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAnalyzeWorkProfile, useWorkProfile } from '@/hooks/queries/useMeOverview'
import { extractApiError } from '@/lib/api-error'
import type { MeOverviewPeriod, WorkProfile, WorkProfileCount } from '@/types/meOverview'

import { OverviewCard } from './OverviewCard'
import { statusLine } from './workProfileModel'

/** 업무 프로파일 카드 — 기간은 개요 탭 기간 고르기를 그대로 따른다. */
export function WorkProfileCard({ period }: { period: MeOverviewPeriod }) {
  const query = useWorkProfile(period)
  const analyze = useAnalyzeWorkProfile(period)
  const profile = query.data
  const pending = profile?.status === 'PENDING'
  // 끝낸 이슈가 없는 기간(NONE)은 분석할 것이 없다 — 눌러도 하루 상한만 쓰고 빈 결과가 남으므로 막는다.
  const nothingToAnalyze = profile?.status === 'NONE'

  // 다시 분석 — 시작(STARTED)·이미 분석 중은 카드가 「분석하는 중」으로 바뀌어 따로 알리지 않는다. 바뀐 게 없을 때와 실패만 토스트.
  const onAnalyze = () =>
    analyze.mutate(undefined, {
      onSuccess: (res) => {
        if (res.outcome === 'UNCHANGED') toast('바뀐 것이 없어 그대로 둡니다')
      },
      // 하루 상한(429)은 서버 문구(「오늘은 더 분석할 수 없어요」)를 우선한다.
      onError: (e) => toast.error(extractApiError(e, '다시 분석하지 못했습니다')),
    })

  return (
    <OverviewCard testId="overview-work-profile" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">업무 프로파일</h2>
          <p className="text-xs text-muted-foreground">끝낸 이슈에서 분석 · 보고서 원자료</p>
        </div>
        <div className="flex items-center gap-2">
          {profile && <StatusText profile={profile} />}
          <Button variant="outline" size="sm" onClick={onAnalyze} disabled={!profile || pending || nothingToAnalyze || analyze.isPending}>
            <RefreshCw aria-hidden />
            다시 분석
          </Button>
        </div>
      </div>
      {query.isError && !profile ? (
        <LoadErrorState
          variant="inline"
          title="업무 프로파일을 불러오지 못했습니다"
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
          testId="overview-work-profile-error"
        />
      ) : !profile ? (
        <Skeleton className="h-40 w-full" aria-busy="true" aria-label="불러오는 중" />
      ) : (
        <ProfileBody profile={profile} />
      )}
    </OverviewCard>
  )
}

/** 머리 오른쪽 상태줄 — 분석 중이면 「분석하는 중…」, 결과가 있으면 「이번 달 n건 분석 · 오늘 08:00」, 그 밖은 비운다. */
function StatusText({ profile }: { profile: WorkProfile }) {
  const text = profile.status === 'PENDING' ? '분석하는 중…' : statusLine(profile, new Date())
  if (!text) return null
  return (
    <span className="text-xs text-muted-foreground" data-testid="work-profile-status">
      {text}
    </span>
  )
}

/**
 * 본문 — 끝낸 이슈가 없으면(READY·NONE 이고 0건) 한 줄 안내. 아니면 왼쪽 요약·안내, 오른쪽 세 그룹(좁은 폭은 위아래로 쌓는다).
 * FAILED 는 0건이어도(첫 분석이 실패해 이전 결과가 없을 때) 빈 상태로 숨기지 않고 오류를 요약 위에 두며, 이전 결과가 있으면 그대로 보인다.
 */
function ProfileBody({ profile }: { profile: WorkProfile }) {
  if ((profile.status === 'READY' || profile.status === 'NONE') && profile.totalCount === 0)
    return (
      <p className="text-sm text-muted-foreground" data-testid="overview-work-profile-empty">
        이 기간에 끝낸 이슈가 없어 분석할 것이 없어요
      </p>
    )
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        {profile.status === 'FAILED' && (
          // 서버가 문구를 주지 않은 실패도 숨기지 않게 기본 문구로 채운다.
          <p className="text-xs text-destructive" data-testid="work-profile-error">
            {profile.error ?? '분석하지 못했어요'}
          </p>
        )}
        {profile.summary ? (
          <p className="text-sm">{profile.summary}</p>
        ) : (
          // 첫 분석 중처럼 아직 요약이 없으면 자리만 잡아 둔다(결과가 오면 같은 자리에 들어선다).
          profile.status === 'PENDING' && <Skeleton className="h-12 w-full" />
        )}
        <p className="text-xs text-muted-foreground">AI 가 끝낸 이슈의 제목·본문·라벨·검토 기록을 읽고 씁니다. 나만 볼 수 있어요.</p>
      </div>
      <div className="space-y-3">
        <CountGroup title="주요 업무" items={profile.tasks} testId="work-profile-tasks" />
        <CountGroup title="자주 일한 영역" items={profile.areas} testId="work-profile-areas" />
        {profile.skills.length > 0 && (
          <TagGroup title="역량" testId="work-profile-skills">
            {profile.skills.map((s) => (
              // 역량은 건수가 없는 성격 태그 — 점선 테두리로 건수 태그와 구분한다.
              <li key={s} className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs">
                {s}
              </li>
            ))}
          </TagGroup>
        )}
      </div>
    </div>
  )
}

/** 건수 태그 그룹 — 「결함 수정 19」. 항목이 없으면 그리지 않는다. */
function CountGroup({ title, items, testId }: { title: string; items: WorkProfileCount[]; testId: string }) {
  if (items.length === 0) return null
  return (
    <TagGroup title={title} testId={testId}>
      {items.map((it) => (
        <li key={it.name} className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {it.name} <span className="tabular-nums text-muted-foreground">{it.count}</span>
        </li>
      ))}
    </TagGroup>
  )
}

/** 라벨 붙은 태그 묶음 — 라벨 한 줄 + 줄바꿈되는 태그 목록. */
function TagGroup({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="flex flex-wrap gap-1.5">{children}</ul>
    </div>
  )
}
