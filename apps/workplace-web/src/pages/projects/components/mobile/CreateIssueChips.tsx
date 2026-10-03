// 모바일 이슈 생성 속성 칩 줄(WP-196) — 시트 맨 아래(=키보드 바로 위, 원칙 ②)에 유형·우선순위·담당자·마감·에픽·✦ AI·⋯ 를 가로 한 줄로.
// 칩을 누르는 순간 입력칸 포커스를 기억하고 blur(키보드 내림) → 선택 시트 → 닫히면 그 칸으로 포커스 복귀(원칙 ③).
// 상위 번호 입력·AI 이유·시작일 표시는 본문 영역 몫이라 여기선 칩 줄과 시트만 렌더한다(showParent 는 부모가 소유).
import { CalendarDays, CalendarPlus, Diamond, Flag, Hash, MoreHorizontal, User } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { MobileActionSheet, type MobileSheetAction } from '@/components/mobile/MobileActionSheet';
import { MobileDateSheet } from '@/components/mobile/MobileDateSheet';
import { MobileMultiPickerSheet } from '@/components/mobile/MobileMultiPickerSheet';
import { MobilePickerSheet } from '@/components/mobile/MobilePickerSheet';
import type { FocusReturn } from '@/hooks/useFocusReturn';
import { cn } from '@/lib/utils';

import { useProjectEpics } from '../../../../hooks/queries/useProjectEpics';
import { useProjectMembers } from '../../../../hooks/queries/useProjectMembers';
import { formatDateMonthDay } from '../../../../lib/formatters';
import { ISSUE_PRIORITY_LABEL } from '../../../../lib/issueGrouping';
import { ISSUE_TYPE_ICONS } from '../../../../lib/issueTypeIcons';
import { getIssueTypeLabel } from '../../../../lib/issueTypeLabels';
import type { IssuePriority } from '../../../../types/issue';
import type { useIssueCreateForm } from '../../hooks/useIssueCreateForm';
import { MOBILE_CHIP, MOBILE_CHIP_ACTIVE } from './chipStyles';

const NO_EPIC = 'none';
type Sheet = 'type' | 'priority' | 'assignee' | 'due' | 'epic' | 'start' | 'more' | null;

export function CreateIssueChips({
  projectKey, personal, f, focusReturn, onShowParent,
}: {
  projectKey: string;
  personal: boolean;
  f: ReturnType<typeof useIssueCreateForm>;
  focusReturn: FocusReturn;
  /** ⋯ → 「상위 이슈 번호」 — 본문 영역 인라인 입력을 띄운다(시트 안 입력칸은 원칙 ③ 위반이라 두지 않음). */
  onShowParent: () => void;
}) {
  const { form, types, selectedType, isEpicSelected, isSubtaskSelected, classify, handleClassify, epicNumber, setEpicNumber } = f;
  const { watch, setValue } = form;
  const [sheet, setSheet] = useState<Sheet>(null);
  // ⋯ 시트에서 액션을 골랐는지 — 액션 없이 닫혔을 때만 포커스를 복귀한다.
  const moreActed = useRef(false);
  const showEpic = !personal && !isEpicSelected && !isSubtaskSelected;
  const members = useProjectMembers(projectKey);
  // 에픽 목록은 에픽 칩을 쓸 수 있을 때만 조회.
  const { epics } = useProjectEpics(projectKey, showEpic);

  const title = watch('title') ?? '';
  const priority = watch('priority') ?? 'MID';
  const assigneeIds = watch('assigneeIds') ?? [];
  const dueDate = watch('dueDate') || null;
  const startDate = watch('startDate') || null;
  const memberList = members.data ?? [];
  const firstAssignee = memberList.find((m) => m.userId === assigneeIds[0]);
  const epic = epics.find((e) => e.number === epicNumber);

  // 시트를 동기로 닫고(포커스 트랩 해제) 같은 클릭 핸들러 안에서 직전 입력칸에 포커스를 돌려준다 — iOS 키보드가 다시 올라오도록.
  const closeSheet = () => {
    flushSync(() => setSheet(null));
    focusReturn.restore();
  };
  // ⋯ 시트: onClose 가 onSelect 보다 먼저 불린다 — 액션이 이어질지 모르므로 복귀는 다음 틱에 판단한다.
  // 여기서 바로 복귀하면 제목 포커스(=키보드)가 돌아온 뒤 날짜 시트가 위에 열리고, 기억도 소진돼 날짜 시트를 닫을 때 돌아갈 곳이 없다.
  const closeMore = () => {
    flushSync(() => setSheet((s) => (s === 'more' ? null : s)));
    queueMicrotask(() => {
      if (!moreActed.current) focusReturn.restore();
      moreActed.current = false;
    });
  };
  // 누르는 순간 포커스가 버튼으로 옮겨가지 않도록 기본 동작만 막는다 — 입력칸 포커스(키보드)는 그대로.
  // 기억(+blur)은 시트를 실제로 여는 onClick 에서 한다: 칩 줄을 가로로 밀다 칩 위에서 시작한 pointerdown 은 click 없이 끝나므로,
  // 여기서 blur 하면 시트 없이 키보드만 내려가고 다음 칩 탭은 body 를 기억해 복귀가 사라진다.
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();
  // 시트 열기 공통 — 직전 입력칸을 기억하고 blur(키보드 내림)한 뒤 시트를 연다(원칙 ③).
  const openSheet = (key: Exclude<Sheet, 'start' | null>) => {
    focusReturn.capture();
    setSheet(key);
  };

  const chip = (key: Exclude<Sheet, 'start' | 'more' | null>, label: string, content: ReactNode, active = false, empty = false) => (
    <button
      type="button"
      aria-label={label}
      data-testid={`create-chip-${key}`}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={() => openSheet(key)}
      className={cn(MOBILE_CHIP, active && MOBILE_CHIP_ACTIVE, empty && 'text-muted-foreground')}
    >
      {content}
    </button>
  );

  const TypeIcon = selectedType ? (ISSUE_TYPE_ICONS[selectedType.icon] ?? ISSUE_TYPE_ICONS.Circle) : null;
  const moreActions: MobileSheetAction[] = [
    {
      key: 'start',
      label: '시작일',
      icon: <CalendarPlus />,
      // 날짜 시트로 이어진다 — 포커스 복귀는 날짜 시트의 closeSheet 가 맡는다.
      onSelect: () => {
        moreActed.current = true;
        setSheet('start');
      },
    },
    ...(isSubtaskSelected
      ? [{
          key: 'parent',
          label: '상위 이슈 번호',
          icon: <Hash />,
          // 제목으로 돌아가지 않고 인라인 번호 입력(autoFocus)으로 간다 — ⋯ 시트 트랩이 풀린 뒤 마운트되도록 이미 동기로 닫았다.
          onSelect: () => {
            moreActed.current = true;
            focusReturn.discard();
            onShowParent();
          },
        }]
      : []),
  ];

  return (
    <>
      {/* 속성 칩은 가로 스크롤 + 오른쪽 32px 페이드(더 있음 신호). 끝 칩이 페이드에 덮이지 않게 pr-8 로 페이드만큼 여유를 둔다.
          py-2 는 칩 HIT_EXPAND(::after 위아래 6px)가 스크롤 영역에 잘리지 않게 유지. ✦ AI·⋯ 는 스크롤 밖 오른쪽에 고정해 항상 보이게(디자인 리뷰). */}
      <div className="flex items-center">
        <div
          data-testid="create-chips-scroller"
          className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-2 pr-8 pl-4 [mask-image:linear-gradient(to_right,#000_calc(100%_-_32px),transparent)] [scrollbar-width:none]"
        >
          {!personal &&
            chip(
              'type',
              '유형',
              <>
                {TypeIcon && <TypeIcon className="size-4" aria-hidden />}
                {selectedType ? getIssueTypeLabel(selectedType.name) : '유형'}
              </>,
            )}
          {chip('priority', '우선순위', <><Flag className="size-4" aria-hidden />{ISSUE_PRIORITY_LABEL[priority]}</>, priority !== 'MID')}
          {chip(
            'assignee',
            '담당자',
            <>
              <User className="size-4" aria-hidden />
              {firstAssignee
                ? `${firstAssignee.name}${assigneeIds.length > 1 ? ` +${assigneeIds.length - 1}` : ''}`
                : '담당자'}
            </>,
            assigneeIds.length > 0,
            assigneeIds.length === 0,
          )}
          {chip('due', '마감일', <><CalendarDays className="size-4" aria-hidden />{dueDate ? formatDateMonthDay(dueDate) : '마감'}</>, !!dueDate, !dueDate)}
          {showEpic &&
            chip(
              'epic',
              '에픽',
              <>
                <Diamond className="size-4 shrink-0 text-ai-accent" aria-hidden />
                <span className="max-w-40 truncate">{epic ? epic.title : '에픽'}</span>
              </>,
              epicNumber != null,
              epicNumber == null,
            )}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-l py-2 pr-4 pl-2">
          {/* ✦ AI — 시트를 열지 않으므로 포커스 왕복 없이 키보드를 유지한다(누를 때 포커스 이동만 막음). */}
          <button
            type="button"
            data-testid="create-chip-ai"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={handleClassify}
            disabled={!title.trim() || classify.isPending}
            className={cn(MOBILE_CHIP, 'text-ai-accent disabled:opacity-50')}
          >
            {classify.isPending ? '제안 중…' : '✦ AI 제안'}
          </button>
          <button
            type="button"
            aria-label="더 보기"
            data-testid="create-chip-more"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => openSheet('more')}
            className={cn(MOBILE_CHIP, 'text-muted-foreground')}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {!personal && (
        <MobilePickerSheet
          testId="create-type-sheet"
          open={sheet === 'type'}
          onClose={closeSheet}
          title="유형"
          value={selectedType ? String(selectedType.id) : null}
          options={(types.data ?? []).map((t) => {
            const Icon = ISSUE_TYPE_ICONS[t.icon] ?? ISSUE_TYPE_ICONS.Circle;
            return { value: String(t.id), label: getIssueTypeLabel(t.name), icon: <Icon aria-hidden /> };
          })}
          onSelect={(v) => setValue('typeId', Number(v))}
        />
      )}
      <MobilePickerSheet
        testId="create-priority-sheet"
        open={sheet === 'priority'}
        onClose={closeSheet}
        title="우선순위"
        value={priority}
        options={(['HIGH', 'MID', 'LOW'] as IssuePriority[]).map((p) => ({ value: p, label: ISSUE_PRIORITY_LABEL[p] }))}
        onSelect={(v) => setValue('priority', v as IssuePriority)}
      />
      <MobileMultiPickerSheet
        testId="create-assignee-sheet"
        open={sheet === 'assignee'}
        title="담당자"
        searchable
        value={assigneeIds.map(String)}
        options={memberList.map((m) => ({ value: String(m.userId), label: m.name }))}
        onClose={(picked) => {
          setValue('assigneeIds', picked.map(Number));
          closeSheet();
        }}
      />
      <MobileDateSheet
        testId="create-due-sheet"
        open={sheet === 'due'}
        onClose={closeSheet}
        title="마감일"
        value={dueDate}
        onSelect={(v) => setValue('dueDate', v ?? '')}
      />
      <MobileDateSheet
        testId="create-start-sheet"
        open={sheet === 'start'}
        onClose={closeSheet}
        title="시작일"
        value={startDate}
        onSelect={(v) => setValue('startDate', v ?? '')}
      />
      {showEpic && (
        <MobilePickerSheet
          testId="create-epic-sheet"
          open={sheet === 'epic'}
          onClose={closeSheet}
          title="에픽"
          searchable={epics.length > 8}
          value={epicNumber != null ? String(epicNumber) : NO_EPIC}
          options={[
            { value: NO_EPIC, label: '에픽 없음' },
            ...epics.map((e) => ({ value: String(e.number), label: e.title, hint: `${e.childDoneCount}/${e.childCount}` })),
          ]}
          onSelect={(v) => setEpicNumber(v === NO_EPIC ? null : Number(v))}
        />
      )}
      <MobileActionSheet
        testId="create-more-sheet"
        open={sheet === 'more'}
        onClose={closeMore}
        title="속성 더 보기"
        actions={moreActions}
      />
    </>
  );
}
