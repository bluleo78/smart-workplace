// 모바일 「◆ 에픽」 칩 + 선택 시트(WP-194) — 데스크톱 EpicSidePanel(224px 고정, 목록을 118px 로 줄임)을 대체.
// 선택은 패널과 같은 useEpicFilter 로 URL(parent/topLevel)에 반영. 칩은 선택 시 「◆ 에픽명 ✕」(✕ = 전체로 복귀).
import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { MobilePickerSheet, type PickerOption } from '@/components/mobile/MobilePickerSheet';
import { cn } from '@/lib/utils';

import { useProjectEpics } from '../../../../hooks/queries/useProjectEpics';
import { useEpicFilter } from '../../hooks/useEpicFilter';
import { IssueCreateDialog } from '../IssueCreateDialog';
import { MOBILE_CHIP } from './MobileIssueToolbar';

export function MobileEpicChip({ projectKey, canCreateIssue }: { projectKey: string; canCreateIssue: boolean }) {
  const { choice, select } = useEpicFilter(projectKey);
  const { epicType, epics } = useProjectEpics(projectKey);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // 칩 라벨 — 선택된 에픽이 첫 페이지 목록에 없으면(URL 직접 진입) 번호로 표시.
  const label =
    choice.kind === 'epic'
      ? (epics.find((e) => e.number === choice.number)?.title ?? `에픽 #${choice.number}`)
      : choice.kind === 'unassigned'
        ? '에픽 미할당'
        : null;

  const options: PickerOption[] = [
    { value: 'all', label: '전체 이슈' },
    ...(epicType ? [{ value: 'unassigned', label: '에픽 미할당' }] : []),
    ...epics.map((ep) => {
      const pct = ep.childCount > 0 ? Math.round((ep.childDoneCount / ep.childCount) * 100) : 0;
      return {
        value: `epic-${ep.number}`,
        label: ep.title,
        // 진행률 바 + 완료/전체 — 데스크톱 패널과 같은 정보.
        hint: (
          <span className="flex items-center gap-1.5 tabular-nums">
            <span className="h-1 w-10 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
            </span>
            {ep.childDoneCount}/{ep.childCount}
          </span>
        ),
      };
    }),
  ];
  const value = choice.kind === 'epic' ? `epic-${choice.number}` : choice.kind;

  function onSelect(v: string) {
    if (v === 'all') select({ kind: 'all' });
    else if (v === 'unassigned') select({ kind: 'unassigned' });
    else select({ kind: 'epic', number: Number(v.slice('epic-'.length)) });
  }

  return (
    <>
      {label ? (
        <span className={cn(MOBILE_CHIP, 'gap-0 border-foreground bg-accent p-0 font-medium')}>
          <button type="button" onClick={() => setOpen(true)} data-testid="mobile-chip-epic" className="flex h-full max-w-[7rem] items-center pl-3 pr-1">
            <span className="truncate">◆ {label}</span>
          </button>
          <button type="button" onClick={() => select({ kind: 'all' })} aria-label="에픽 필터 해제" data-testid="mobile-chip-epic-clear" className="flex h-full items-center pl-1 pr-2.5">
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setOpen(true)} data-testid="mobile-chip-epic" className={MOBILE_CHIP}>
          ◆ 에픽
        </button>
      )}
      <MobilePickerSheet
        open={open}
        onClose={() => setOpen(false)}
        title="에픽"
        testId="mobile-epic-sheet"
        options={options}
        value={value}
        onSelect={onSelect}
        searchable={epics.length > 8}
        headerAction={
          canCreateIssue && epicType ? (
            <button
              type="button"
              data-testid="mobile-epic-create"
              onClick={() => {
                // 시트와 다이얼로그를 동시에 띄우지 않는다 — 시트 닫고 생성 다이얼로그.
                setOpen(false);
                setCreateOpen(true);
              }}
              className="inline-flex min-h-11 items-center gap-1 text-sm text-primary"
            >
              <Plus className="size-4" /> 에픽 만들기
            </button>
          ) : null
        }
      />
      {epicType && (
        <IssueCreateDialog projectKey={projectKey} open={createOpen} onOpenChange={setCreateOpen} initialTypeId={epicType.id} />
      )}
    </>
  );
}
