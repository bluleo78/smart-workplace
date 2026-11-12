// 「보고서 만들기」 창(WP-1486) — 업무 프로파일 카드 머리의 단추가 연다. 종류(일일/주간/월간) → 기간(날짜·주·달) → 저장 위치(읽기 전용)
// → 「초안 만들기」. 만들기는 202 + 3초 폴링(P15)이라 단추가 「만드는 중…」으로 바뀌고, 끝나면 「다 만들었어요」·「만든 노트 열기」.
// 이 컴포넌트는 창이 닫혀도 카드 안에 그대로 붙어 있어(닫히는 것은 DialogContent 뿐) 폴링이 계속 돌고, 닫힌 채 끝나면 토스트로 알린다.
// 같은 회차가 있으면(409 REPORT_EXISTS) 「이미 있음 — {제목}」과 열기 / 새로 만들기(force), 이미 만드는 중(409 REPORT_IN_PROGRESS)이면
// 그 회차를 이어 폴링한다. 비서가 없으면 경고와 함께 단추를 잠근다(P10). 하루 상한(429)은 서버 문구를 창 안에 보인다.
import { Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { meReportConflict } from '@/api/meReports'
import { AiLabel } from '@/components/ai/AiLabel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCreateMeReport, useMeReport, useMeReportSettings } from '@/hooks/queries/useMeReports'
import { extractApiError } from '@/lib/api-error'
import { wikiPagePath } from '@/lib/appUrl'
import { kstDateKey } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { CreateMeReportRequest, MeReportKind } from '@/types/meReport'

import { defaultDaily, defaultMonth, defaultWeekStart, monthFolderLabel, recentMonths, recentWeeks } from './meReportModel'
import { NO_ASSISTANT_TEXT } from './ReportSettingsDialog'

/** 종류 세그먼트 — 보이는 순서 그대로. */
const KIND_OPTIONS: { value: MeReportKind; label: string }[] = [
  { value: 'DAILY', label: '일일' },
  { value: 'WEEKLY', label: '주간' },
  { value: 'MONTHLY', label: '월간' },
]

/** 끝남 토스트 「{일일|주간|월간} 보고를 만들었어요」의 앞말 — 세그먼트 문구에서 그대로 끌어온다. */
const KIND_LABEL = Object.fromEntries(KIND_OPTIONS.map((o) => [o.value, o.label])) as Record<MeReportKind, string>

/** 종류별 기본 기간 — 일일은 어제 날짜, 주간은 지난주 월요일, 월간은 지난달(「YYYY-MM」). */
function defaultPeriods(today: string): Record<MeReportKind, string> {
  return { DAILY: defaultDaily(today), WEEKLY: defaultWeekStart(today), MONTHLY: defaultMonth(today) }
}

interface CreateReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 아래쪽 「보고서 설정」 — 카드가 이 창을 닫고 설정 창을 연다(P1). */
  onOpenSettings: () => void
}

/** 만들기 창 — 열고 닫기는 카드가 정하고, 진행 중인 회차(job)와 폴링·토스트는 여기서 들고 있는다. */
export function CreateReportDialog({ open, onOpenChange, onOpenSettings }: CreateReportDialogProps) {
  const navigate = useNavigate()
  // 오늘(KST) — 기본 기간·보기 목록의 기준. 카드가 붙은 채 자정을 넘길 수 있어 창을 열 때마다 다시 정한다(아래 「다시 열면」).
  const [today, setToday] = useState(() => kstDateKey(new Date()))
  const [kind, setKind] = useState<MeReportKind>('DAILY')
  // 종류별로 고른 기간 — 종류를 오가도 각자 고른 값이 남는다.
  const [periods, setPeriods] = useState(() => defaultPeriods(today))
  // 같은 회차가 이미 있을 때(409 REPORT_EXISTS) 보일 노트.
  const [conflict, setConflict] = useState<{ pageId: number | null; title: string } | null>(null)
  // 창 안 오류 한 줄 — 하루 상한(429)·비서 없음(409 NO_ASSISTANT) 등 서버 문구.
  const [error, setError] = useState<string | null>(null)
  // 진행 중(또는 막 끝난) 회차 — 창을 닫아도 남아 폴링을 이어 간다.
  const [job, setJob] = useState<{ id: number; kind: MeReportKind } | null>(null)
  // 「다시 시도」가 보낼 마지막 요청 — 토스트 액션은 창이 닫힌 뒤에도 같은 요청을 다시 보낸다.
  const lastRequest = useRef<CreateMeReportRequest | null>(null)
  // 끝남을 이미 처리(토스트·표시)한 회차 id — 같은 결과로 두 번 알리지 않게.
  const handled = useRef<number | null>(null)

  const settings = useMeReportSettings({ enabled: open })
  const create = useCreateMeReport()
  const report = useMeReport(job?.id ?? null)
  const status = job ? report.data?.status : undefined
  // 만드는 중 — 요청을 보낸 뒤 202 를 기다리거나, 회차가 아직 PENDING(첫 상태를 받기 전 포함).
  const busy = create.isPending || (job != null && !report.isError && (status == null || status === 'PENDING'))
  const done = status === 'GENERATED'
  const assistantMissing = settings.data?.assistantAvailable === false

  // 다시 열면 오늘(KST)을 새로 구해 기본 기간을 그 기준으로 되돌리고, 지난 결과(다 만들었어요·이미 있음·오류)를 지워 고르기부터 —
  // 만드는 중이면 고른 기간·결과를 그대로 이어 보인다(기간 단추가 잠겨 있다). 렌더 중 조정(이전 open 과 비교)으로 해 effect 안 setState 를 피한다.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open && !busy) {
      const now = kstDateKey(new Date())
      setToday(now)
      setPeriods(defaultPeriods(now))
      setJob(null)
      setConflict(null)
      setError(null)
    }
  }

  /** 만들기 요청 — 202 면 그 회차를 폴링, 409 는 code 로 가르고, 그 밖(429 등)은 서버 문구를 창 안에. */
  const start = (req: CreateMeReportRequest) => {
    lastRequest.current = req
    setConflict(null)
    setError(null)
    setJob(null)
    create.mutate(req, {
      onSuccess: (res) => setJob({ id: res.id, kind: req.kind }),
      onError: (e) => {
        const c = meReportConflict(e)
        // 이미 만드는 중 — 만들기가 받아들여진 것처럼 그 회차를 이어 폴링한다.
        if (c?.code === 'REPORT_IN_PROGRESS' && c.id != null) setJob({ id: c.id, kind: req.kind })
        else if (c?.code === 'REPORT_EXISTS') setConflict({ pageId: c.pageId ?? null, title: c.title ?? '' })
        else if (c?.code === 'NO_ASSISTANT') setError(c.message ?? NO_ASSISTANT_TEXT)
        else setError(extractApiError(e, '보고를 만들지 못했습니다'))
      },
    })
  }

  /** 지금 고른 종류·기간으로 요청 본문을 만든다 — 종류에 맞는 기간 값 하나만 싣는다. */
  const request = (force: boolean): CreateMeReportRequest =>
    kind === 'DAILY'
      ? { kind, date: periods.DAILY, force }
      : kind === 'WEEKLY'
        ? { kind, weekStart: periods.WEEKLY, force }
        : { kind, month: periods.MONTHLY, force }

  // 회차가 끝나면 한 번만 알린다 — 열린 창에서 끝나면 창이 「다 만들었어요」를 보이므로 성공 토스트는 닫혀 있을 때만,
  // 실패는 창이 열려 있어도 토스트(「다시 시도」 액션)로 알리고 창은 다시 고를 수 있는 상태로 돌아간다.
  const finished = report.data
  useEffect(() => {
    if (!job || !finished || finished.id !== job.id || finished.status === 'PENDING' || handled.current === finished.id) return
    if (finished.status === 'GENERATED') {
      handled.current = finished.id
      if (open) return
      const pageId = finished.pageId
      toast.success(`${KIND_LABEL[job.kind]} 보고를 만들었어요`, {
        action: pageId != null ? { label: '열기', onClick: () => navigate(wikiPagePath(pageId)) } : undefined,
      })
      return
    }
    handled.current = finished.id
    toast.error(finished.error ?? '보고를 만들지 못했어요', {
      action: { label: '다시 시도', onClick: () => lastRequest.current && start(lastRequest.current) },
    })
    // start 는 렌더마다 새로 만들어지지만 토스트가 잡은 것으로 충분하다(같은 요청을 다시 보낸다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, job, open, navigate])

  // 기간을 바꾸면 「이미 있음」·오류는 지난 고르기의 것이라 지운다.
  const pick = (fn: () => void) => {
    fn()
    setConflict(null)
    setError(null)
  }

  const periodValue = periods[kind]
  /** 지금 종류의 기간을 바꾼다. */
  const setPeriod = (k: MeReportKind, v: string) => pick(() => setPeriods((p) => ({ ...p, [k]: v })))
  const canSubmit = !busy && !!periodValue && settings.data != null && !assistantMissing

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 도움말 문맥 — 열린 동안 매뉴얼 「내 일일·주간·월간 보고를 받는다」 절. */}
      <DialogContent data-testid="me-report-create" data-help="me.reports.create">
        <DialogHeader>
          <DialogTitle>보고서 만들기</DialogTitle>
          <DialogDescription>숫자는 시스템이 세고 AI 가 글을 써 내 노트에 초안으로 남겨요. 고친 뒤 노트 공유로 내보내세요.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="종류">
            <div role="group" aria-label="보고 종류" className="inline-flex rounded-md border border-border p-0.5">
              {KIND_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={kind === o.value}
                  disabled={busy}
                  onClick={() => pick(() => setKind(o.value))}
                  className={cn(
                    'rounded px-3 py-1 text-sm',
                    kind === o.value ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="기간">
            {kind === 'DAILY' ? (
              <Input
                type="date"
                aria-label="날짜"
                className="w-44"
                value={periods.DAILY}
                max={today}
                disabled={busy}
                onChange={(e) => setPeriod('DAILY', e.target.value)}
              />
            ) : kind === 'WEEKLY' ? (
              <PeriodSelect
                label="주"
                value={periods.WEEKLY}
                disabled={busy}
                options={recentWeeks(today).map((w) => ({ value: w.weekStart, label: w.label }))}
                onChange={(v) => setPeriod('WEEKLY', v)}
              />
            ) : (
              <PeriodSelect
                label="달"
                value={periods.MONTHLY}
                disabled={busy}
                options={recentMonths(today).map((m) => ({ value: m.month, label: m.label }))}
                onChange={(v) => setPeriod('MONTHLY', v)}
              />
            )}
          </Field>

          <Field label="저장 위치">
            <span className="text-sm" data-testid="me-report-location">
              {monthFolderLabel(kind, periodValue)}
            </span>
          </Field>

          {assistantMissing && (
            <p className="flex items-center gap-1.5 text-xs text-warning-text" data-testid="me-report-create-no-assistant">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {NO_ASSISTANT_TEXT}
            </p>
          )}

          {conflict && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm" data-testid="me-report-exists">
              <span className="min-w-0 flex-1">이미 있음 — {conflict.title}</span>
              {conflict.pageId != null && (
                <Button asChild variant="outline" size="sm">
                  <Link to={wikiPagePath(conflict.pageId)}>열기</Link>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => start(request(true))} disabled={busy}>
                새로 만들기
              </Button>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          {job && report.isError && (
            <p className="text-xs text-destructive" role="alert">
              진행 상태를 확인하지 못했어요
            </p>
          )}
          {busy && job && <p className="text-xs text-muted-foreground">1~3분 걸릴 수 있어요. 창을 닫아도 계속 만들어요.</p>}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <Button variant="link" size="sm" className="px-0" onClick={onOpenSettings}>
            보고서 설정
          </Button>
          {done ? (
            <div className="flex items-center gap-2">
              <span className="text-sm">다 만들었어요</span>
              {report.data?.pageId != null && (
                <Button asChild size="sm">
                  <Link to={wikiPagePath(report.data.pageId)}>만든 노트 열기</Link>
                </Button>
              )}
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => start(request(false))} disabled={!canSubmit}>
              {busy ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  만드는 중…
                </>
              ) : (
                <AiLabel>초안 만들기</AiLabel>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 이름 + 내용 한 줄 — 좁은 폭에서는 내용이 아래로 내려간다. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  )
}

/** 주·달 고르기 — 최신이 위. */
function PeriodSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className="w-52">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
