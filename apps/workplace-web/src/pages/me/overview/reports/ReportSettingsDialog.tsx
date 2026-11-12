// 「보고서 설정」 창(WP-1486) — 내 작업 개요의 업무 프로파일 카드 ⚙ 단추와 「보고서 만들기」 창 아래 링크가 연다(P1).
// 시안 ② 그대로 네 줄: 일일 보고(켬·시각·어제 것·건너뜀) / 일일 템플릿 / 주간 템플릿 / 저장 위치. 「기본으로 되돌리기」는 두지 않는다(P11 —
// 템플릿 노트의 수정 기록으로 되돌릴 수 있다). 저장은 프로젝트 리포트 설정과 같은 방식: 바꾸는 즉시 PUT(세 값 모두), 낙관적으로 먼저 보이고
// 실패하면 서버 값으로 되돌린다.
import { ArrowUpRight, TriangleAlert } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { BusySwitch } from '@/components/BusySwitch'
import { LoadErrorState } from '@/components/LoadErrorState'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useMeReportSettings, useUpdateMeReportSettings } from '@/hooks/queries/useMeReports'
import { handleApiError } from '@/lib/api-error'
import { wikiPagePath } from '@/lib/appUrl'
import type { MeReportSettings, UpdateMeReportSettingsRequest } from '@/types/meReport'

import { hourOptions, nextRunLabel } from './meReportModel'

/** 비서 없음 경고 — 설정·만들기 두 창이 같은 문구를 쓴다(P10). */
export const NO_ASSISTANT_TEXT = 'AI 비서가 없어 보고를 만들 수 없어요'

/** 템플릿이 아직 없을 때 — 프로젝트 리포트 설정과 같은 문구(켤 때 서버가 「보고」 아래에 복사한다). */
const WILL_CREATE_TEXT = '켜면 노트에 만들어요'

/** 이미 켜져 있는데 템플릿을 지웠을 때 — 켜기는 다시 일어나지 않으므로, 다음 보고를 만들 때 서버가 다시 복사한다고 알린다. */
const WILL_RECREATE_TEXT = '다음 보고 때 다시 만들어요'

const HOURS = hourOptions()

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

/** 네 줄 — 일일 보고 / 일일 템플릿 / 주간 템플릿 / 저장 위치, 그 아래 비서 없음 경고·마지막 실패. */
function SettingsRows({ server }: { server: MeReportSettings }) {
  const update = useUpdateMeReportSettings()
  // 방금 바꾼 값(낙관적 표시) — 저장 응답이 캐시에 들어오면 놓고, 실패하면 비워 서버 값으로 되돌린다.
  const [pending, setPending] = useState<UpdateMeReportSettingsRequest | null>(null)
  // 저장 중의 새 바꾸기를 막는다 — 같은 틱의 두 번째 바꾸기는 다시 그리기 전이라 update.isPending 이 아직 false 여서 ref 로 본다.
  const savingRef = useRef(false)

  const value: UpdateMeReportSettingsRequest = pending ?? {
    dailyEnabled: server.dailyEnabled,
    timeOfDay: server.timeOfDay,
    skipEmpty: server.skipEmpty,
  }

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
        <TemplateLink pageId={server.dailyTemplatePageId} enabled={server.dailyEnabled} title="템플릿 · 일일 보고" hint="한 줄 / 어제 / 오늘 / 막힌 것" />
      </SettingsRow>

      <SettingsRow label="주간 템플릿">
        <TemplateLink pageId={server.weeklyTemplatePageId} enabled={server.dailyEnabled} title="템플릿 · 주간 보고" hint="필요할 때 만들기 · 월간도 이 템플릿" />
      </SettingsRow>

      <SettingsRow label="저장 위치">
        {server.reportsPageId != null ? (
          <Link to={wikiPagePath(server.reportsPageId)} className={LINK_CLASS}>
            내 노트 › 보고
          </Link>
        ) : (
          <span className="text-sm">내 노트 › 보고</span>
        )}
      </SettingsRow>

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
