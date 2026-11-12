import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';

import { SettingsSection, SettingsToggleRow } from '@/components/layout/SettingsSection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select';

import { useUpdateProject } from '../../../hooks/queries/useProjects';
import { handleApiError } from '../../../lib/api-error';
import type { ProjectResponse, StatusSummaryInterval } from '../../../types/project';

/** 간격 보기 — 서버 값과 화면 문구(보이는 순서 그대로). */
const INTERVAL_OPTIONS: { value: StatusSummaryInterval; label: string }[] = [
  { value: 'H1', label: '1시간' },
  { value: 'H2', label: '2시간' },
  { value: 'H4', label: '4시간' },
  { value: 'DAILY', label: '하루 한 번' },
];

/** 서버 기본 간격 — 값을 싣지 않는 구버전 응답도 이 값으로 보인다. */
const DEFAULT_INTERVAL: StatusSummaryInterval = 'H2';

interface StatusSummarySettingsProps {
  project: ProjectResponse;
  /** 저장 권한(소유자·관리자). 없으면 선택 상자가 비활성. */
  canManage: boolean;
  /** 같은 섹션의 상태 요약 줄 아래에 더할 줄(주간 리포트 — WP-1483). */
  children?: ReactNode;
}

/**
 * 프로젝트 설정 「리포트」(WP-1479) — 개요 맨 위 「프로젝트 상태」 AI 요약을 얼마나 자주 새로 쓸지 정한다.
 * 고르는 즉시 기존 PATCH 에 statusSummaryInterval 만 실어 저장한다(댓글 섹션 WP-1495 와 같은 방식 — 저장 단추 없음).
 * 섹션 머리는 여기서 그리고, 주간 리포트(WP-1483) 줄은 children 으로 받아 상태 요약 줄 아래에 둔다 — 시안처럼 한 섹션.
 * 개인 프로젝트에서는 그리지 않는다는 판단은 부모(ProjectSettingsPage)가 한다 — 개인 프로젝트는 요약을 만들지 않는다.
 */
export function StatusSummarySettings({ project, canManage, children }: StatusSummarySettingsProps) {
  const update = useUpdateProject(project.key);
  // 방금 고른 값(낙관적 표시) — 재조회가 끝날 때까지 옛 값으로 깜빡이지 않게 먼저 보이고, 실패하면 비워 서버 값으로 되돌린다.
  const [pending, setPending] = useState<StatusSummaryInterval | null>(null);
  const serverValue = project.statusSummaryInterval ?? DEFAULT_INTERVAL;

  // 재조회 결과가 고른 값을 따라잡으면 낙관 값을 놓는다(렌더 중 상태 조정 — effect 안 setState 를 피한다).
  if (pending !== null && pending === serverValue) setPending(null);

  const onChange = async (next: StatusSummaryInterval) => {
    if (next === (pending ?? serverValue)) return;
    setPending(next);
    try {
      await update.mutateAsync({ statusSummaryInterval: next });
      const label = INTERVAL_OPTIONS.find((o) => o.value === next)?.label ?? next;
      toast.success(`상태 요약 간격을 ${label}으로 바꿨어요`);
    } catch (e) {
      setPending(null);
      handleApiError(e, '저장에 실패했습니다');
    }
  };

  return (
    <SettingsSection
      title="리포트"
      description="개요 맨 위 AI 상태 요약과, AI 가 노트에 쓰는 주간 리포트를 언제 쓸지 정해요."
      data-testid="project-report-settings"
    >
      <SettingsToggleRow
        label={<label htmlFor="settings-status-summary-interval">상태 요약 간격</label>}
        description="리포트와 별개, 개요 카드 전용 — 그사이 바뀐 것이 없으면 요약을 다시 쓰지 않아요."
        control={
          <Select
            value={pending ?? serverValue}
            onValueChange={(v) => void onChange(v as StatusSummaryInterval)}
            disabled={!canManage || update.isPending}
          >
            <SelectTrigger id="settings-status-summary-interval" className="w-32" data-testid="settings-status-summary-interval">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVAL_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {children}
    </SettingsSection>
  );
}
