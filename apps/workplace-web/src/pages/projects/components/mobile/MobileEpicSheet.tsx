// 모바일 「◆ 에픽」 칩 + 선택 시트(WP-194) — 데스크톱 EpicSidePanel(224px 고정, 목록을 118px 로 줄임)을 대체.
// 선택은 패널과 같은 useEpicFilter 로 URL(parent/topLevel)에 반영. 칩은 선택 시 「◆ 에픽명 ✕」(✕ = 전체로 복귀).
// 에픽 행 끝 「›」 = 시트를 닫고 에픽 상세로 이동(WP-227, 데스크톱 패널 hover ↗ 의 모바일 대응).
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { MobilePickerSheet, type PickerOption } from '@/components/mobile/MobilePickerSheet';
import { cn } from '@/lib/utils';

import { useProjectEpics } from '../../../../hooks/queries/useProjectEpics';
import { useEpicFilter } from '../../hooks/useEpicFilter';
import { IssueCreateDialog } from '../IssueCreateDialog';
import { HIT_EXPAND, MOBILE_CHIP, MOBILE_CHIP_ACTIVE } from './chipStyles';

export function MobileEpicChip({ projectKey, canCreateIssue }: { projectKey: string; canCreateIssue: boolean }) {
  const { choice, select } = useEpicFilter(projectKey);
  const { epicType, epics } = useProjectEpics(projectKey);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();

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
        detail: { label: `${ep.title} 상세 열기`, onOpen: () => navigate(`/projects/${projectKey}/issues/${ep.number}`) },
        // 진행률 바 + 완료/전체 — 데스크톱 패널과 같은 정보. 트랙은 bg-border — bg-muted 는 시트 배경과 거의 같아 0% 가 안 보인다.
        // 숫자 칸은 폭 고정(7ch — 「/」 가 0 보다 넓어 「999/999」 까지 여유)·오른쪽 정렬 — 「0/0」과 「10/125」처럼 길이가 달라도 바가 줄마다 같은 x 에 선다.
        hint: (
          <span className="flex items-center gap-1.5 tabular-nums">
            <span className="h-1 w-11 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
            </span>
            <span className="min-w-[7ch] text-right">{ep.childDoneCount}/{ep.childCount}</span>
          </span>
        ),
      };
    }),
  ];
  const value = choice.kind === 'epic' ? `epic-${choice.number}` : choice.kind;

  function onSelect(v: string) {
    // 이미 선택된 항목을 다시 누르면 아무것도 하지 않는다 — useEpicFilter.select 는 같은 선택을 해제(토글)하는데
    // (데스크톱 패널 의미), 시트에선 체크된 항목 재탭이 필터를 지우면 의도와 반대라서.
    if (v === value) return;
    if (v === 'all') select({ kind: 'all' });
    else if (v === 'unassigned') select({ kind: 'unassigned' });
    else select({ kind: 'epic', number: Number(v.slice('epic-'.length)) });
  }

  return (
    <>
      {label ? (
        // 감싼 span 의 ::after 는 끈다(after:hidden) — 두 버튼 위를 덮어 클릭을 가로채지 않게. 터치 확장은 각 버튼의 ::after 가 맡는다.
        <span className={cn(MOBILE_CHIP, MOBILE_CHIP_ACTIVE, 'gap-0 p-0 after:hidden')}>
          <button type="button" onClick={() => setOpen(true)} data-testid="mobile-chip-epic" className={cn('flex h-full max-w-[7rem] items-center pl-3 pr-1', HIT_EXPAND)}>
            <span className="truncate">◆ {label}</span>
          </button>
          {/* ✕ — 칩 테두리(1px)까지 덮어 보이는 영역 36×32, ::after 로 위아래를 넓혀 터치 영역 36×44. 칩·툴바 높이는 그대로. */}
          <button type="button" onClick={() => select({ kind: 'all' })} aria-label="에픽 필터 해제" data-testid="mobile-chip-epic-clear" className={cn('-my-px -mr-px flex h-8 min-w-9 items-center justify-center rounded-r-full pl-1 pr-3', HIT_EXPAND)}>
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
        reserveCheck
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
      {/* 열 때만 마운트 — 닫힌 생성 다이얼로그(폼·쿼리)를 칩마다 상시 들고 있지 않는다. */}
      {createOpen && epicType && (
        <IssueCreateDialog projectKey={projectKey} open onOpenChange={setCreateOpen} initialTypeId={epicType.id} />
      )}
    </>
  );
}
