import { ArrowUpRight } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { BusySwitch } from '@/components/BusySwitch';
import { SettingsToggleRow } from '@/components/layout/SettingsSection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { formatKstMonthDayWeekdayClock } from '@/lib/formatters';
import { HOUR_OPTIONS } from '@/lib/hourOptions';

import {
  useProjectReportSettings,
  useResetProjectReportTemplate,
  useUpdateProjectReportSettings,
} from '../../../hooks/queries/useProjectReportSettings';
import { handleApiError } from '../../../lib/api-error';
import type { ReportCadence, ReportWeekday, UpdateProjectReportSettingsRequest } from '../../../types/projectReport';
import { projectNotePath } from '../tabs/projectTabs';

/** 주기 보기 — 서버 값과 화면 문구(보이는 순서 그대로). 매월은 그 달 첫 번째 고른 요일에 쓴다. */
const CADENCE_OPTIONS: { value: ReportCadence; label: string }[] = [
  { value: 'WEEKLY', label: '매주' },
  { value: 'BIWEEKLY', label: '격주' },
  { value: 'MONTHLY', label: '매월' },
];

/** 요일 보기 — 월요일부터(리포트 회차가 월~일이라 월요일이 기본). */
const WEEKDAY_OPTIONS: { value: ReportWeekday; label: string }[] = [
  { value: 'MONDAY', label: '월요일' },
  { value: 'TUESDAY', label: '화요일' },
  { value: 'WEDNESDAY', label: '수요일' },
  { value: 'THURSDAY', label: '목요일' },
  { value: 'FRIDAY', label: '금요일' },
  { value: 'SATURDAY', label: '토요일' },
  { value: 'SUNDAY', label: '일요일' },
];

/** 시각 보기 — 정시만(서버가 「HH:00」 만 받는다). 값과 문구가 같다. 목록은 공용 HOUR_OPTIONS. */
const TIME_OPTIONS: { value: string; label: string }[] = HOUR_OPTIONS.map((t) => ({ value: t, label: t }));

/** 되돌리기 확인 창 문구 — 스펙 「웹」 그대로. */
const RESET_TITLE = '템플릿을 기본으로 되돌릴까요?';
const RESET_BODY = '지금 템플릿 내용을 제품 기본 샘플과 지시로 바꿉니다. 지금 내용은 노트의 수정 기록에서 다시 꺼낼 수 있어요.';

interface ReportSettingsProps {
  projectKey: string;
  /** 화면이 본 관리 권한(OWNER·ADMIN). 서버 응답의 canManage 와 둘 다 참일 때만 고칠 수 있다. */
  canManage: boolean;
}

/**
 * 프로젝트 설정 「리포트」 섹션의 주간 리포트 줄들(WP-1483) — 켬/끔·주기·요일·시각, 템플릿 링크·되돌리기, 저장 위치.
 * 섹션 머리는 StatusSummarySettings 가 그리고 이 컴포넌트는 그 안(상태 요약 줄 아래)에 줄만 더한다 — 시안처럼 한 섹션에 둔다.
 * 저장은 상태 요약 간격과 같은 방식: 바꾸면 바로 PUT(네 값을 모두 싣는다), 낙관적으로 먼저 보이고 실패하면 서버 값으로 되돌린다.
 */
export function ReportSettings({ projectKey, canManage }: ReportSettingsProps) {
  const query = useProjectReportSettings(projectKey);
  const update = useUpdateProjectReportSettings(projectKey);
  const reset = useResetProjectReportTemplate(projectKey);
  // 방금 고른 값(낙관적 표시) — 저장 응답이 캐시에 들어오면 놓고, 실패하면 비워 서버 값으로 되돌린다.
  const [pending, setPending] = useState<UpdateProjectReportSettingsRequest | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 저장 중 표시 — 선택 상자를 disabled 로 잠그면 초점이 body 로 떨어져(WP-847 과 같은 문제) 잠그지 않고 이 값으로 새 저장만 막는다.
  // ref 인 이유: 같은 틱의 두 번째 고르기는 다시 그리기 전이라 update.isPending 이 아직 false 다.
  const savingRef = useRef(false);

  if (query.isPending) return null;
  if (query.isError || !query.data) {
    return <p className="text-sm text-muted-foreground">주간 리포트 설정을 불러오지 못했어요.</p>;
  }

  const server = query.data;
  // 개인 프로젝트 등 서버가 막는 경우도 읽기 전용으로 — 화면 권한과 서버 판단이 둘 다 허락해야 고친다.
  const editable = canManage && server.canManage;
  const value: UpdateProjectReportSettingsRequest = pending ?? {
    enabled: server.enabled,
    cadence: server.cadence,
    weekday: server.weekday,
    timeOfDay: server.timeOfDay,
  };
  const templatePath = server.templatePageId != null ? projectNotePath(projectKey, server.templatePageId) : null;

  const save = async (patch: Partial<UpdateProjectReportSettingsRequest>, done: string) => {
    // 저장 중의 바꾸기는 무시한다 — 요청 순서가 엇갈려 옛 값이 마지막에 남지 않게(값은 늘 제어라 화면에 남지 않는다).
    if (savingRef.current) return;
    savingRef.current = true;
    const next = { ...value, ...patch };
    setPending(next);
    try {
      await update.mutateAsync(next);
      toast.success(done);
    } catch (e) {
      handleApiError(e, '저장에 실패했습니다');
    } finally {
      // 성공이면 응답이 이미 캐시에 있고(onSuccess), 실패면 서버 값으로 돌아간다 — 어느 쪽이든 낙관 값을 놓는다.
      setPending(null);
      savingRef.current = false;
    }
  };

  const onConfirmReset = async () => {
    try {
      await reset.mutateAsync();
      toast.success('템플릿을 기본으로 되돌렸어요');
      setConfirmOpen(false);
    } catch (e) {
      handleApiError(e, '템플릿을 되돌리지 못했습니다');
    }
  };

  // 주기·요일·시각은 켜져 있을 때만 의미가 있어 꺼짐이면 잠근다. 저장 중에는 잠그지 않는다(초점 유지 — save 가 새 저장을 막는다).
  const scheduleDisabled = !editable || !value.enabled;
  const nextRun = value.enabled && server.nextRunAt && pending === null ? formatKstMonthDayWeekdayClock(server.nextRunAt) : null;

  return (
    <>
      <SettingsToggleRow
        data-testid="settings-report-enabled-row"
        label={<label htmlFor="settings-report-enabled">주간 리포트</label>}
        description={
          <>
            켜면 정한 때마다 지난 회차를 AI 가 노트에 리포트로 써요.
            {nextRun && <span className="block">다음 리포트 {nextRun}</span>}
          </>
        }
        control={
          <BusySwitch
            id="settings-report-enabled"
            checked={value.enabled}
            busy={update.isPending}
            disabled={!editable}
            onCheckedChange={(on) => void save({ enabled: on }, on ? '주간 리포트를 켰어요' : '주간 리포트를 껐어요')}
          />
        }
      />

      <ReportRow label="주기">
        <ScheduleSelect
          label="리포트 주기"
          testId="settings-report-cadence"
          value={value.cadence}
          options={CADENCE_OPTIONS}
          disabled={scheduleDisabled}
          busy={update.isPending}
          onChange={(v) => void save({ cadence: v }, '리포트 주기를 바꿨어요')}
        />
        <ScheduleSelect
          label="리포트 요일"
          testId="settings-report-weekday"
          value={value.weekday}
          options={WEEKDAY_OPTIONS}
          disabled={scheduleDisabled}
          busy={update.isPending}
          onChange={(v) => void save({ weekday: v }, '리포트 요일을 바꿨어요')}
        />
        <ScheduleSelect
          label="리포트 시각"
          testId="settings-report-time"
          value={value.timeOfDay}
          options={TIME_OPTIONS}
          disabled={scheduleDisabled}
          busy={update.isPending}
          onChange={(v) => void save({ timeOfDay: v }, '리포트 시각을 바꿨어요')}
        />
      </ReportRow>

      <ReportRow label="템플릿">
        {templatePath ? (
          <>
            <Link to={templatePath} className="inline-flex items-center gap-0.5 rounded-sm text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
              템플릿 · 주간 리포트
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
            <Link to={templatePath} className="rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
              노트에서 고치기
            </Link>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">켜면 노트에 만들어요</span>
        )}
        {/* 되돌리기는 관리 권한이 있고 템플릿이 있을 때만 — 없으면 「켜면 노트에 만들어요」와 어긋나고, 켤 때 서버가 기본 템플릿을 복사한다. */}
        {editable && templatePath && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={reset.isPending}
            data-testid="settings-report-template-reset"
          >
            기본으로 되돌리기
          </Button>
        )}
      </ReportRow>

      <ReportRow label="저장 위치">
        <span className="text-sm">프로젝트 노트 › 리포트</span>
      </ReportRow>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !reset.isPending && setConfirmOpen(open)}>
        <AlertDialogContent data-help="project-settings.report.reset">
          <AlertDialogHeader>
            <AlertDialogTitle>{RESET_TITLE}</AlertDialogTitle>
            <AlertDialogDescription>{RESET_BODY}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reset.isPending}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // 요청이 끝날 때까지 창을 열어 둔다 — 닫는 일은 onConfirmReset 이 결과를 보고 한다.
                e.preventDefault();
                void onConfirmReset();
              }}
              disabled={reset.isPending}
            >
              되돌리기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * 주기·요일·시각 선택 상자 하나 — 셋이 모양(너비·aria-busy·보기 목록)이 같아 한 곳에서 그린다.
 * 저장 중(busy)에도 잠그지 않는다(초점 유지 — 새 저장은 save 가 막는다). 꺼짐·권한 없음만 disabled.
 */
function ScheduleSelect<T extends string>({
  label,
  testId,
  value,
  options,
  disabled,
  busy,
  onChange,
}: {
  label: string;
  testId: string;
  value: T;
  options: { value: T; label: string }[];
  disabled: boolean;
  busy: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <SelectTrigger aria-label={label} aria-busy={busy || undefined} className="w-24" data-testid={testId}>
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
  );
}

/**
 * 이름 + 오른쪽 내용 한 줄 — 내용(선택 상자 셋·링크·단추)이 좁은 폭에서 넘치지 않게 줄바꿈한다.
 * SettingsToggleRow 는 컨트롤 칸이 줄어들지 않아(shrink-0) 선택 상자 셋이 360px 에서 가로로 넘친다.
 */
function ReportRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}
