// 모바일 이슈 생성 속성 칩 줄(WP-196) — 시트 맨 아래(=키보드 바로 위, 원칙 ②)에 유형·우선순위·담당자·구성요소·마감·에픽·✦ AI·⋯ 를 가로 한 줄로.
// 칩을 누르는 순간 입력칸 포커스를 기억하고 blur(키보드 내림) → 선택 시트 → 닫히면 그 칸으로 포커스 복귀(원칙 ③).
// 상위 번호 입력·AI 이유·시작일 표시는 본문 영역 몫이라 여기선 칩 줄과 시트만 렌더한다.
import { Boxes, CalendarDays, CalendarPlus, Diamond, Flag, Hash, MoreHorizontal, User } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { MobileActionSheet, type MobileSheetAction } from '@/components/mobile/MobileActionSheet';
import { MobileDateSheet } from '@/components/mobile/MobileDateSheet';
import { MobileMultiPickerSheet } from '@/components/mobile/MobileMultiPickerSheet';
import { MobilePickerSheet } from '@/components/mobile/MobilePickerSheet';
import type { FocusReturn } from '@/hooks/useFocusReturn';
import { keepFocusProps } from '@/lib/keepFocus';
import { cn } from '@/lib/utils';

import { useProjectEpics } from '../../../../hooks/queries/useProjectEpics';
import { useProjectMembers } from '../../../../hooks/queries/useProjectMembers';
import { formatDateMonthDay } from '../../../../lib/formatters';
import { ISSUE_PRIORITY_LABEL, ISSUE_PRIORITY_OPTIONS } from '../../../../lib/issueGrouping';
import { formatIssueKey } from '../../../../lib/issueKey';
import { ISSUE_TYPE_ICONS } from '../../../../lib/issueTypeIcons';
import { getIssueTypeLabel } from '../../../../lib/issueTypeLabels';
import { labelWithValue } from '../../../../lib/labelWithValue';
import type { IssuePriority } from '../../../../types/issue';
import type { useIssueCreateForm } from '../../hooks/useIssueCreateForm';
import { MOBILE_CHIP, MOBILE_CHIP_ACTIVE } from './chipStyles';
import { epicSheetValue } from './epicSheetValue';
import { memberOptions } from './issuePropOptions';
import { ComponentPickerSheet, EpicPickerSheet } from './issuePropSheets';

type Sheet = 'type' | 'priority' | 'assignee' | 'component' | 'due' | 'epic' | 'start' | 'more' | null;

export function CreateIssueChips({
  projectKey, personal, f, focusReturn, onFocusParent,
}: {
  projectKey: string;
  personal: boolean;
  f: ReturnType<typeof useIssueCreateForm>;
  focusReturn: FocusReturn;
  /** ⋯ → 「상위 이슈 번호」 — 본문 영역의 (항상 보이는) 인라인 입력으로 포커스를 옮긴다(시트 안 입력칸은 원칙 ③ 위반이라 두지 않음). */
  onFocusParent: () => void;
}) {
  const { form, types, selectedType, isEpicSelected, isSubtaskSelected, classify, handleClassify, epic: epicChoice, setEpic } = f;
  // 구성요소(WP-933) — 구성원이고 사용 중 구성요소가 있을 때만 칩을 둔다.
  const { showComponents, componentList, componentIds, setComponentIds } = f;
  const { watch, setValue } = form;
  const [sheet, setSheet] = useState<Sheet>(null);
  // ⋯ 시트에서 액션을 골랐는지 — 액션 없이 닫혔을 때만 포커스를 복귀한다.
  const moreActed = useRef(false);
  const showEpic = !personal && !isEpicSelected && !isSubtaskSelected;
  const members = useProjectMembers(projectKey);
  // 에픽 목록은 에픽 칩을 처음 누를 때(pointerdown — 시트가 열리기 전에 응답이 오도록) 조회를 시작한다(이후 유지) — 고른 에픽의 칩 라벨도 이 목록에서 찾으므로 한 번 켜면 끄지 않는다.
  // 에픽은 시트를 열어야만 고를 수 있어, 선택값이 있으면 목록도 이미 조회돼 있다.
  const [epicsWanted, setEpicsWanted] = useState(false);
  const { epics, loading: epicsLoading } = useProjectEpics(projectKey, showEpic && epicsWanted);

  const title = watch('title') ?? '';
  const priority = watch('priority') ?? 'MID';
  const assigneeIds = watch('assigneeIds') ?? [];
  const dueDate = watch('dueDate') || null;
  const startDate = watch('startDate') || null;
  const memberList = members.data ?? [];
  const firstAssignee = memberList.find((m) => m.userId === assigneeIds[0]);
  // 같은 프로젝트 에픽은 목록에서 제목을 찾고, 다른 프로젝트 에픽(WP-1039)은 고를 때 실은 키·제목을 쓴다.
  // 시트와 같은 판정(epicSheetValue) — 이 프로젝트 에픽이면 그 번호 값, 없음·다른 프로젝트면 번호가 아니라 목록에서 찾지 못한다.
  const ownEpicValue = epicSheetValue(epicChoice, projectKey);
  const epic = epics.find((e) => String(e.number) === ownEpicValue);
  // 칩에 그리는 값 글자 — aria-label 이 칩 안 글자를 덮어쓰므로 고른 값은 접근 이름에도 같은 문자열로 붙인다(WP-853).
  // 고르기 전에는 칩이 속성 이름(유형·담당자·마감·에픽)만 보여 주므로 값을 붙이지 않는다.
  const typeText = selectedType ? getIssueTypeLabel(selectedType.name) : null;
  const priorityText = ISSUE_PRIORITY_LABEL[priority];
  const assigneeText = firstAssignee
    ? `${firstAssignee.name}${assigneeIds.length > 1 ? ` +${assigneeIds.length - 1}` : ''}`
    : null;
  const dueText = dueDate ? formatDateMonthDay(dueDate) : null;
  const epicText = epic
    ? epic.title
    : epicChoice?.projectKey
      ? `${formatIssueKey(epicChoice.projectKey, epicChoice.number)} ${epicChoice.title ?? ''}`.trim()
      : null;
  // 구성요소 칩 글자 — 첫 이름 + 「+N」(담당자 칩과 같은 모양).
  const firstComponent = componentList.find((c) => c.id === componentIds[0]);
  const componentText = firstComponent
    ? `${firstComponent.name}${componentIds.length > 1 ? ` +${componentIds.length - 1}` : ''}`
    : null;

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
  // 시트 열기 공통 — 직전 입력칸을 기억하고 blur(키보드 내림)한 뒤 시트를 연다(원칙 ③).
  // 칩은 누르는 순간 포커스를 빼앗지 않고(keepFocusProps), 기억(+blur)은 시트를 실제로 여는 onClick 에서 한다:
  // 칩 줄을 가로로 밀다 칩 위에서 시작한 pointerdown 은 click 없이 끝나므로, pointerdown 에서 blur 하면
  // 시트 없이 키보드만 내려가고 다음 칩 탭은 body 를 기억해 복귀가 사라진다.
  const openSheet = (key: Exclude<Sheet, 'start' | null>) => {
    focusReturn.capture();
    if (key === 'epic') setEpicsWanted(true);
    setSheet(key);
  };

  const chip = (key: Exclude<Sheet, 'start' | 'more' | null>, label: string, content: ReactNode, active = false, empty = false) => (
    <button
      type="button"
      aria-label={label}
      data-testid={`create-chip-${key}`}
      {...keepFocusProps}
      onPointerDown={(e) => {
        keepFocusProps.onPointerDown(e);
        if (key === 'epic') setEpicsWanted(true);
      }}
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
          // 제목으로 돌아가지 않고 인라인 번호 입력으로 포커스를 보낸다 — ⋯ 시트 트랩이 풀린 뒤 마운트되도록 이미 동기로 닫았다.
          onSelect: () => {
            moreActed.current = true;
            focusReturn.discard();
            onFocusParent();
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
              labelWithValue('유형', typeText),
              <>
                {TypeIcon && <TypeIcon className="size-4" aria-hidden />}
                {typeText ?? '유형'}
              </>,
            )}
          {chip('priority', labelWithValue('우선순위', priorityText), <><Flag className="size-4" aria-hidden />{priorityText}</>, priority !== 'MID')}
          {chip(
            'assignee',
            labelWithValue('담당자', assigneeText),
            <>
              <User className="size-4" aria-hidden />
              {assigneeText ?? '담당자'}
            </>,
            assigneeIds.length > 0,
            assigneeIds.length === 0,
          )}
          {showComponents &&
            chip(
              'component',
              labelWithValue('구성요소', componentText),
              <>
                <Boxes className="size-4" aria-hidden />
                <span className="max-w-40 truncate">{componentText ?? '구성요소'}</span>
              </>,
              componentIds.length > 0,
              componentIds.length === 0,
            )}
          {chip('due', labelWithValue('마감일', dueText), <><CalendarDays className="size-4" aria-hidden />{dueText ?? '마감'}</>, !!dueDate, !dueDate)}
          {showEpic &&
            chip(
              'epic',
              labelWithValue('에픽', epicText),
              <>
                <Diamond className="size-4 shrink-0 text-ai-accent" aria-hidden />
                <span className="max-w-40 truncate">{epicText ?? '에픽'}</span>
              </>,
              epicChoice != null,
              epicChoice == null,
            )}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-l py-2 pr-4 pl-2">
          {/* ✦ AI — 시트를 열지 않으므로 포커스 왕복 없이 키보드를 유지한다(누를 때 포커스 이동만 막음). */}
          <button
            type="button"
            data-testid="create-chip-ai"
            {...keepFocusProps}
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
            {...keepFocusProps}
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
        options={ISSUE_PRIORITY_OPTIONS}
        onSelect={(v) => setValue('priority', v as IssuePriority)}
      />
      <MobileMultiPickerSheet
        testId="create-assignee-sheet"
        open={sheet === 'assignee'}
        title="담당자"
        countUnit="명"
        searchable
        value={assigneeIds.map(String)}
        options={memberOptions(memberList)}
        onClose={(picked) => {
          setValue('assigneeIds', picked.map(Number));
          closeSheet();
        }}
      />
      {showComponents && (
        <ComponentPickerSheet
          testId="create-component-sheet"
          open={sheet === 'component'}
          components={componentList}
          value={componentIds}
          onClose={(ids) => {
            setComponentIds(ids);
            closeSheet();
          }}
        />
      )}
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
        <EpicPickerSheet
          testId="create-epic-sheet"
          open={sheet === 'epic'}
          onClose={closeSheet}
          epics={epics}
          loading={epicsLoading}
          // 다른 프로젝트 에픽을 골랐으면 이 프로젝트 줄 어디에도 체크하지 않는다.
          value={epicChoice}
          // 다른 프로젝트 에픽도 찾아 고른다(WP-1039) — 생성 요청에 parentKey 로 실린다(키·제목은 칩 글자로도 쓴다).
          projectKey={projectKey}
          onSelect={setEpic}
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
