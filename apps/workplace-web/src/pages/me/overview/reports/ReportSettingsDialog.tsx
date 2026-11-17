// 「보고서 설정」 창(WP-1486) — 내 작업 개요의 업무 프로파일 카드 ⚙ 단추와 「보고서 만들기」 창 아래 링크가 연다(P1).
// 네 줄: 일일 보고(켬·시각·어제 것·건너뜀) / 일일 템플릿 / 주간·월간 템플릿 / 저장 위치. 「기본으로 되돌리기」는 두지 않는다(P11 —
// 템플릿 노트의 수정 기록으로 되돌릴 수 있다). 저장은 프로젝트 리포트 설정과 같은 방식: 바꾸는 즉시 PUT(세 값 모두), 낙관적으로 먼저 보이고
// 실패하면 서버 값으로 되돌린다.
// WP-1655: 템플릿은 내 노트 「템플릿」 아래에 있고 어디로 옮겨도 id 로 따라가므로 링크 글자는 지금 경로(기본 「템플릿 › 일일 보고」).
// 없어진 템플릿을 서버가 다시 만들었으면 템플릿 줄 아래 「템플릿을 다시 만들었어요」. 저장 위치는 「내 노트 › {경로}」 링크 +
// 「바꾸기」 → 공용 고르기 창(ReportLocationDialog — 「템플릿」·템플릿 갈래와 달 폴더 갈래는 뺀다) → 위치 PUT. 성공이면 토스트와 함께
// 고르기 창만 닫고, 실패(400)면 이유를 알리고 고르기 창을 열어 둔다. 고르기 창은 이 창 위에 겹쳐 열리는 Radix Dialog 라 Esc 는 위의 창만 닫는다.
import { ArrowUpRight, TriangleAlert } from 'lucide-react'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { BusySwitch } from '@/components/BusySwitch'
import { LoadErrorState } from '@/components/LoadErrorState'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ReportLocationDialog } from '@/components/wiki/ReportLocationDialog'
import { useMeReportSettings, useUpdateMeReportLocation, useUpdateMeReportSettings } from '@/hooks/queries/useMeReports'
import { handleApiError } from '@/lib/api-error'
import { wikiPagePath } from '@/lib/appUrl'
import { isMonthFolderTitle } from '@/lib/reportMonthFolder'
import type { MeReportSettings, UpdateMeReportSettingsRequest } from '@/types/meReport'
import type { WikiPageSummary } from '@/types/wiki'

import { hourOptions, locationBaseLabel, nextRunLabel } from './meReportModel'

/** 비서 없음 경고 — 설정·만들기 두 창이 같은 문구를 쓴다(P10). */
export const NO_ASSISTANT_TEXT = 'AI 비서가 없어 보고를 만들 수 없어요'

/** 템플릿이 아직 없을 때 — 프로젝트 리포트 설정과 같은 문구(켤 때 서버가 「템플릿」 아래에 복사한다). */
const WILL_CREATE_TEXT = '켜면 노트에 만들어요'

/**
 * 켜진 동안 템플릿을 지웠거나 내 노트 밖으로 옮겼을 때(응답 id 가 null) — 서버는 다음 보고를 만들 때(그 전에 설정을 저장하면 그때) 「템플릿」 아래에
 * 다시 복사하고 「템플릿을 다시 만들었어요」로 알린다(WP-1655). 사용자가 기다리는 때인 「다음 보고」를 안내한다.
 */
const WILL_RECREATE_TEXT = '다음 보고 때 다시 만들어요'

const HOURS = hourOptions()

/** 템플릿 경로가 없을 때(드문 응답)의 링크 글자 — 서버가 처음 만드는 자리·이름. */
const DAILY_TEMPLATE_DEFAULT = '템플릿 › 일일 보고'
const WEEKLY_TEMPLATE_DEFAULT = '템플릿 › 주간·월간 보고'

/** 고르기 창 문구(WP-1655) — 프로젝트 리포트 문구 대신 개인 보고 것. */
const LOCATION_TITLE = '보고 저장 위치'
const LOCATION_DESCRIPTION = '새 보고를 고른 페이지 아래에 달별로 모아 만들어요. 이미 만든 보고는 그대로 둬요.'
const LOCATION_EMPTY = '고를 페이지가 없으면 다음 보고 때 「보고」를 만들어요.'

/**
 * 달 폴더(「2026년 11월」)와 그 아래는 고를 수 없다 — 서버도 400 으로 거절한다(같은 규칙).
 * 모듈 함수로 둔다: 고르기 창의 목록 계산(useMemo) 의존값이라 렌더마다 새 함수면 늘 다시 계산된다.
 */
const isMonthFolderPage = (page: WikiPageSummary) => isMonthFolderTitle(page.title)

/** 경로를 「 › 」로 잇는다 — 없거나 비면 기본 글자. */
const joinPath = (path: string[] | null, fallback: string) => (path && path.length > 0 ? path.join(' › ') : fallback)

const LINK_CLASS =
  'inline-flex items-center gap-0.5 rounded-sm text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'

/** 창 — 열려 있을 때만 설정을 읽는다. */
export function ReportSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 도움말 문맥(WP-1506) — 열린 동안 도움말 패널이 매뉴얼 「보고서를 설정한다」 절을 보인다. */}
      <DialogContent data-testid="me-report-settings" data-help="me.reports.settings">
        <DialogHeader>
          <DialogTitle>보고서 설정</DialogTitle>
          <DialogDescription>매일 아침 어제 한 일을 AI 가 내 노트에 일일 보고로 정리해요. 나만 볼 수 있어요.</DialogDescription>
        </DialogHeader>
        {open && <SettingsBody />}
      </DialogContent>
    </Dialog>
  )
}

/** 창 본문 — 불러오기·실패·네 줄. */
function SettingsBody() {
  const query = useMeReportSettings()
  if (query.isError && !query.data)
    return (
      <LoadErrorState
        variant="inline"
        title="보고서 설정을 불러오지 못했습니다"
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
        testId="me-report-settings-error"
      />
    )
  if (!query.data) return <Skeleton className="h-40 w-full" aria-busy="true" aria-label="불러오는 중" />
  return <SettingsRows server={query.data} />
}

/** 네 줄 — 일일 보고 / 일일 템플릿 / 주간·월간 템플릿 / 저장 위치, 그 아래 비서 없음 경고·마지막 실패. */
function SettingsRows({ server }: { server: MeReportSettings }) {
  const update = useUpdateMeReportSettings()
  const updateLocation = useUpdateMeReportLocation()
  // 「보고 저장 위치」 고르기 창(WP-1655)
  const [locationOpen, setLocationOpen] = useState(false)
  // 방금 바꾼 값(낙관적 표시) — 저장 응답이 캐시에 들어오면 놓고, 실패하면 비워 서버 값으로 되돌린다.
  const [pending, setPending] = useState<UpdateMeReportSettingsRequest | null>(null)
  // 저장 중의 새 바꾸기를 막는다 — 같은 틱의 두 번째 바꾸기는 다시 그리기 전이라 update.isPending 이 아직 false 여서 ref 로 본다.
  const savingRef = useRef(false)

  const value: UpdateMeReportSettingsRequest = pending ?? {
    dailyEnabled: server.dailyEnabled,
    timeOfDay: server.timeOfDay,
    skipEmpty: server.skipEmpty,
  }

  // 고르기 창에서 뺄 갈래 — 맨 위 「템플릿」 갈래와, 그 밖으로 옮긴 두 템플릿 갈래는 보고 자리가 아니다(서버 검증과 같은 기준).
  // 매번 새 배열을 넘기면 창의 목록 계산(useMemo)이 늘 다시 돌아 id 값으로 묶어 둔다.
  const { templateRootPageId, dailyTemplatePageId, weeklyTemplatePageId } = server
  const blockedRootIds = useMemo(
    () => [templateRootPageId, dailyTemplatePageId, weeklyTemplatePageId].filter((id): id is number => id != null),
    [templateRootPageId, dailyTemplatePageId, weeklyTemplatePageId],
  )

  const save = async (patch: Partial<UpdateMeReportSettingsRequest>, done: string) => {
    // 저장 중 바꾸기는 무시 — 요청 순서가 엇갈려 옛 값이 마지막에 남지 않게(값은 늘 제어라 화면에 남지 않는다).
    if (savingRef.current) return
    savingRef.current = true
    const next = { ...value, ...patch }
    setPending(next)
    try {
      await update.mutateAsync(next)
      toast.success(done)
    } catch (e) {
      handleApiError(e, '저장에 실패했습니다')
    } finally {
      setPending(null)
      savingRef.current = false
    }
  }

  /** 저장 위치 바꾸기 — 성공하면 고르기 창을 닫고, 실패하면 이유를 알리고 창을 열어 둔다(다른 페이지를 다시 고르게). */
  const onSaveLocation = async (pageId: number) => {
    try {
      await updateLocation.mutateAsync(pageId)
      toast.success('저장 위치를 바꿨어요')
      setLocationOpen(false)
    } catch (e) {
      handleApiError(e, '저장 위치를 바꾸지 못했습니다')
    }
  }

  const locationLabel = locationBaseLabel(server.reportLocationPath ?? undefined)

  // 시각·건너뜀은 켜져 있을 때만 의미가 있어 꺼짐이면 잠근다. 저장 중에는 잠그지 않는다(초점 유지 — save 가 새 저장을 막는다).
  const scheduleDisabled = !value.dailyEnabled
  const nextRun = value.dailyEnabled && server.nextRunAt && pending === null ? nextRunLabel(server.nextRunAt) : null

  return (
    <div className="space-y-4">
      <SettingsRow label={<label htmlFor="me-report-daily">일일 보고</label>}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <BusySwitch
            id="me-report-daily"
            checked={value.dailyEnabled}
            busy={update.isPending}
            onCheckedChange={(on) => void save({ dailyEnabled: on }, on ? '일일 보고를 켰어요' : '일일 보고를 껐어요')}
          />
          <Select
            value={value.timeOfDay}
            onValueChange={(t) => void save({ timeOfDay: t }, '보고 시각을 바꿨어요')}
            disabled={scheduleDisabled}
          >
            <SelectTrigger aria-label="보고 시각" aria-busy={update.isPending || undefined} className="w-24" data-testid="me-report-time">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">· 어제 것</span>
        </div>
        <label className="flex items-center justify-end gap-2 text-xs">
          <Checkbox
            checked={value.skipEmpty}
            disabled={scheduleDisabled}
            aria-busy={update.isPending || undefined}
            onCheckedChange={(c) => void save({ skipEmpty: c === true }, '건너뜀 설정을 바꿨어요')}
          />
          한 일이 없는 날은 건너뜀
        </label>
        {nextRun && <p className="text-right text-xs text-muted-foreground">{nextRun}</p>}
      </SettingsRow>

      <SettingsRow label="일일 템플릿">
        <TemplateLink
          pageId={server.dailyTemplatePageId}
          enabled={server.dailyEnabled}
          title={joinPath(server.dailyTemplatePath, DAILY_TEMPLATE_DEFAULT)}
          hint="한 줄 / 어제 / 오늘 / 막힌 것"
        />
      </SettingsRow>

      <SettingsRow label="주간·월간 템플릿">
        <TemplateLink
          pageId={server.weeklyTemplatePageId}
          enabled={server.dailyEnabled}
          title={joinPath(server.weeklyTemplatePath, WEEKLY_TEMPLATE_DEFAULT)}
          hint="필요할 때 만들기"
        />
      </SettingsRow>
      {/* 없어진 템플릿을 서버가 다시 만들었을 때 한 번 알린다 — 다음에 설정을 쓰면 서버가 지운다. */}
      {server.templateRecreatedAt && (
        <p className="-mt-2 text-right text-xs text-muted-foreground" data-testid="me-report-template-recreated">
          템플릿을 다시 만들었어요
        </p>
      )}

      <SettingsRow label="저장 위치">
        {/* 지금 쓰는 위치(고른 페이지, 아니면 「보고」)가 있으면 링크 — 아직 「보고」도 없으면 글자만(다음 보고 때 만든다). */}
        {server.reportsPageId != null ? (
          <Link to={wikiPagePath(server.reportsPageId)} className={LINK_CLASS}>
            {locationLabel}
          </Link>
        ) : (
          <span className="text-sm">{locationLabel}</span>
        )}
        {/* 내 노트 공간이 아직 없으면 고를 트리가 없다 — 첫 보고 때 공간과 「보고」를 만든다. */}
        {server.spaceId != null && (
          <Button variant="outline" size="sm" onClick={() => setLocationOpen(true)} data-testid="me-report-location-change">
            바꾸기
          </Button>
        )}
      </SettingsRow>

      <ReportLocationDialog
        open={locationOpen}
        spaceId={server.spaceId}
        currentPageId={server.reportsPageId}
        blockedRootIds={blockedRootIds}
        title={LOCATION_TITLE}
        description={LOCATION_DESCRIPTION}
        emptyText={LOCATION_EMPTY}
        isBlockedPage={isMonthFolderPage}
        saving={updateLocation.isPending}
        helpId="me.reports.location"
        onClose={() => setLocationOpen(false)}
        onSave={(pageId) => void onSaveLocation(pageId)}
      />

      {!server.assistantAvailable && (
        <p className="flex items-center gap-1.5 text-xs text-warning-text" data-testid="me-report-no-assistant">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {NO_ASSISTANT_TEXT}
        </p>
      )}
      {/* 자동 생성 실패는 알림 대신 여기 한 줄만(P9). */}
      {server.lastError && (
        <p className="text-xs text-destructive" data-testid="me-report-last-error">
          마지막 실패: {server.lastError}
        </p>
      )}
    </div>
  )
}

/**
 * 템플릿 링크 + 줄 설명 — 템플릿이 없으면, 꺼져 있을 땐 「켜면 노트에 만들어요」, 이미 켜져 있으면(사람이 지움) 「다음 보고 때 다시 만들어요」.
 * enabled 는 서버에 저장된 켬 상태다(템플릿 유무도 서버 값이라 같은 출처로 맞춘다).
 */
function TemplateLink({
  pageId,
  enabled,
  title,
  hint,
}: {
  pageId: number | null
  enabled: boolean
  title: string
  hint: string
}) {
  if (pageId == null) {
    return <span className="text-xs text-muted-foreground">{enabled ? WILL_RECREATE_TEXT : WILL_CREATE_TEXT}</span>
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <Link to={wikiPagePath(pageId)} className={LINK_CLASS}>
        {title}
        <ArrowUpRight className="size-3.5" aria-hidden />
      </Link>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

/** 표 모양 한 줄 — 왼쪽 이름, 오른쪽 내용. 좁은 폭에서는 내용이 아래로 내려간다(flex-wrap). */
function SettingsRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <div className="pt-1 text-sm font-medium">{label}</div>
      <div className="flex min-w-0 flex-col items-end gap-1.5">{children}</div>
    </div>
  )
}
