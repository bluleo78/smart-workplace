// 이슈 1건 액션(모바일 길게 누르기) — 목록·보드가 하나씩 소유하고, 행·카드는 open(issue) 만 호출한다(행 memo 유지).
// 액션 시트 → (상태 | 에픽) 선택 시트 순서로 한 번에 하나만 연다. 변경은 기존 낙관적 mutation(드래그와 같은 경로)을 재사용.
import { CheckSquare, CircleDot, Layers } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';

import { MobileActionSheet, type MobileSheetAction } from '@/components/mobile/MobileActionSheet';
import { MobilePickerSheet } from '@/components/mobile/MobilePickerSheet';
import { useIsMobile } from '@/hooks/useIsMobile';

import { useMoveIssueEpic } from '../../../hooks/queries/useMoveIssueEpic';
import { useProjectEpics } from '../../../hooks/queries/useProjectEpics';
import { useUpdateIssueStatus } from '../../../hooks/queries/useUpdateIssueStatus';
import { epicDragBlockReason } from '../../../lib/epicDnd';
import { ISSUE_STATUS_LABEL } from '../../../lib/issueGrouping';
import type { IssueResponse, IssueStatus } from '../../../types/issue';

// 「에픽 없음」 선택지 값 — 에픽 번호(양의 정수)와 겹치지 않는 문자열.
const NO_EPIC = 'none';
const ALL_STATUSES: IssueStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'];

type Open = { issue: IssueResponse; sheet: 'actions' | 'status' | 'epic' } | null;

export function useIssueRowActions({
  projectKey, canEdit, statuses = ALL_STATUSES, onSelect,
}: {
  projectKey: string;
  /** 프로젝트 멤버 여부 — 아니면 상태·에픽 변경을 노출하지 않는다(서버 assertMember). */
  canEdit: boolean;
  /** 보드 컬럼 등 허용 상태(개인 보드는 3개). */
  statuses?: IssueStatus[];
  /** 목록 다중 선택 진입 — 있으면 「선택」 행을 첫 줄에 둔다. */
  onSelect?: (issue: IssueResponse) => void;
}): { open: (issue: IssueResponse) => void; sheets: ReactNode } {
  const [state, setState] = useState<Open>(null);
  const updateStatus = useUpdateIssueStatus(projectKey);
  const moveEpic = useMoveIssueEpic(projectKey);
  const isMobile = useIsMobile();
  // 에픽 목록은 에픽 시트를 열 때만 필요하지만 훅 순서 고정 — 모바일 멤버일 때만 조회(데스크톱 요청 불변).
  const { epics, epicType } = useProjectEpics(projectKey, canEdit && isMobile);

  // 액션이 하나도 없으면(비멤버 + 선택 불가) 열지 않는다. open 은 안정 참조 — 행 memo 가 깨지지 않게.
  const hasAny = canEdit || onSelect != null;
  const open = useCallback((issue: IssueResponse) => {
    if (hasAny) setState({ issue, sheet: 'actions' });
  }, [hasAny]);
  const close = () => setState(null);

  const issue = state?.issue;
  const actions: MobileSheetAction[] = [];
  if (issue && onSelect) actions.push({ key: 'select', label: '선택', icon: <CheckSquare />, onSelect: () => onSelect(issue) });
  // EPIC 유형이 없는 프로젝트(개인)는 지정할 에픽이 없으므로 행을 숨긴다.
  if (issue && canEdit && epicType && epicDragBlockReason(issue) == null) {
    actions.push({ key: 'epic', label: '에픽 지정', icon: <Layers />, onSelect: () => setState({ issue, sheet: 'epic' }) });
  }
  if (issue && canEdit) {
    actions.push({ key: 'status', label: '상태 변경', icon: <CircleDot />, onSelect: () => setState({ issue, sheet: 'status' }) });
  }

  const sheets = (
    <>
      <MobileActionSheet
        open={state?.sheet === 'actions'}
        onClose={close}
        title={issue?.title ?? ''}
        actions={actions}
      />
      <MobilePickerSheet
        testId="issue-status-picker"
        open={state?.sheet === 'status'}
        onClose={close}
        title="상태 변경"
        value={issue?.status ?? null}
        options={statuses.map((s) => ({ value: s, label: ISSUE_STATUS_LABEL[s] }))}
        onSelect={(v) => {
          if (issue && v !== issue.status) updateStatus.mutate({ number: issue.number, status: v as IssueStatus });
        }}
      />
      <MobilePickerSheet
        testId="issue-epic-picker"
        open={state?.sheet === 'epic'}
        onClose={close}
        title="에픽 지정"
        searchable={epics.length > 8}
        value={issue ? String(issue.parent?.number ?? NO_EPIC) : null}
        options={[
          { value: NO_EPIC, label: '에픽 없음' },
          ...epics.map((e) => ({ value: String(e.number), label: e.title, hint: `${e.childDoneCount}/${e.childCount}` })),
        ]}
        onSelect={(v) => {
          if (!issue) return;
          const target = v === NO_EPIC ? null : epics.find((e) => String(e.number) === v);
          const to = target && target.type ? { number: target.number, title: target.title, type: target.type } : null;
          if ((to?.number ?? null) !== (issue.parent?.number ?? null)) moveEpic.mutate({ issue, to });
        }}
      />
    </>
  );
  return { open, sheets };
}
