// 프로젝트 이슈 화면 공용 드래그 앤 드롭 컨텍스트.
// 왜: dnd-kit 은 같은 DndContext 안의 droppable 에만 드롭을 인식한다. 보드가 자기 DndContext 를 가지면 옆의 에픽 패널로
//     놓을 수 없으므로, 페이지가 패널+보드/목록을 이 provider 하나로 감싼다.
// - 에픽 드롭(epic-{n}/epic-none)·사이클 구간 드롭(cycle-section-*, #881)은 여기서 처리, 보드 상태 드롭은 보드가 useDndMonitor 로 구독(관심사 분리).
// - DragOverlay 도 여기서 그린다(card=IssueCard 고스트, row=행 요약 칩).
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { useMoveIssueCycle } from '../../../hooks/queries/useMoveIssueCycle';
import { useMoveIssueEpic } from '../../../hooks/queries/useMoveIssueEpic';
import {
  epicDropState,
  isCycleDropData,
  isEpicDropData,
  ISSUE_DND_SCREEN_READER_INSTRUCTIONS,
  issueCollision,
  issueDndAnnouncements,
  type IssueDragData,
  issueKeyboardCoordinates,
  sameCycleSection,
  snapRowChipToPointer,
} from '../../../lib/epicDnd';
import type { IssueResponse } from '../../../types/issue';
import { IssueCard } from './IssueCard';

// 렌더마다 새 배열을 만들지 않도록 모듈 상수로 둔다.
const ROW_OVERLAY_MODIFIERS = [snapRowChipToPointer];

type IssueDndState = { activeIssue: IssueResponse | null };
const IssueDndCtx = createContext<IssueDndState | null>(null);

// provider 안이면 드래그 상태, 밖이면 null — 보드는 null 일 때 자체 provider 로 감싼다.
// eslint-disable-next-line react-refresh/only-export-components -- context 와 훅을 한 파일에 두는 것이 응집상 낫다
export function useIssueDnd() {
  return useContext(IssueDndCtx);
}

export function IssueDndProvider({ projectKey, children }: { projectKey: string; children: ReactNode }) {
  const [active, setActive] = useState<IssueDragData | null>(null);
  const moveEpic = useMoveIssueEpic(projectKey);
  const moveCycle = useMoveIssueCycle(projectKey);
  // PointerSensor distance:5 — 짧은 클릭은 링크/행 이동으로 남긴다.
  // 키보드 시작은 Space 만 — Enter 는 카드·행 안 링크의 상세 이동으로 남긴다(#881).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: issueKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  // 자동 스크롤 제한 — 포인터가 에픽 패널의 드롭 항목(전체·미할당·에픽) 위에 있으면 배경(목록·보드·페이지) 스크롤 컨테이너를 굴리지 않는다.
  // 왜: 도킹 패널은 페이지 스크롤 영역 안에 있어, 스크롤된 화면에서 가장자리(20%) 근처 에픽에 머물면 페이지가 굴러
  //     에픽이 포인터 밑에서 빠져나가고 over 가 바뀐다. 항목이 아닌 곳(패널 여백·목록 가장자리)의 자동 스크롤은 그대로 둬,
  //     긴 목록 아래에서 끌어 올려 도킹 패널을 드러내는 흐름은 유지한다.
  // 패널 안의 스크롤 컨테이너(에픽 목록)는 항상 허용 — 긴 에픽 목록 가장자리에 머물러 가려진 에픽을 드러내야 한다.
  //   (떠 있는 패널은 스크롤 조상이 목록뿐이라, 막으면 목록이 전혀 굴러가지 않는다.)
  // 포인터 좌표는 capture 단계에서 기록 — dnd-kit 센서(document 리스너)가 렌더→자동 스크롤 판정하기 전에 최신값이 되도록.
  // 이벤트마다 객체를 만들지 않도록 미리 만든 객체를 갱신한다. valid=false 는 포인터 좌표 없음(키보드 드래그·드래그 밖).
  const pointerRef = useRef({ x: 0, y: 0, valid: false });
  useEffect(() => {
    if (!active) return;
    const p = pointerRef.current;
    const onMove = (e: PointerEvent) => {
      p.x = e.clientX;
      p.y = e.clientY;
      p.valid = true;
    };
    window.addEventListener('pointermove', onMove, { capture: true });
    return () => {
      window.removeEventListener('pointermove', onMove, { capture: true });
      p.valid = false;
    };
  }, [active]);
  const autoScroll = useMemo(
    () => ({
      canScroll: (el: Element) => {
        if (el.closest('[data-epic-panel]') != null) return true;
        const p = pointerRef.current;
        if (!p.valid) return true; // 키보드 드래그 → 기본 동작
        // 포인터 지점 히트 테스트 — elementsFromPoint 는 스크롤 조상의 잘림을 반영하므로, 목록 스크롤로 가려진 에픽 항목은
        // 잡히지 않는다(보이는 부분만 「포인터가 항목 위」로 본다 — 충돌 판정과 같은 규칙).
        return !document
          .elementsFromPoint(p.x, p.y)
          .some((hit) => hit.closest('[data-epic-panel] [data-drop-state]') != null);
      },
    }),
    [],
  );
  // 스크린리더 안내 — 이슈 키·대상 이름(한국어), 원시 id 는 읽지 않는다.
  const accessibility = useMemo(
    () => ({ announcements: issueDndAnnouncements(projectKey), screenReaderInstructions: ISSUE_DND_SCREEN_READER_INSTRUCTIONS }),
    [projectKey],
  );

  function handleDragStart(e: DragStartEvent) {
    setActive((e.active.data.current as IssueDragData | undefined) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActive(null);
    const src = e.active.data.current as IssueDragData | undefined;
    const dst = e.over?.data.current;
    if (!src) return;
    // 사이클 구간 드롭(#881) — 사이클 그룹 목록의 행만(출발 구간을 알아야 from 을 정한다). 같은 구간이면 변화 없음.
    if (isCycleDropData(dst)) {
      const from = src.cycleSection;
      if (!from || sameCycleSection(from, dst.cycleSection)) return;
      moveCycle.mutate({ issue: src.issue, from, to: dst.cycleSection });
      return;
    }
    if (!isEpicDropData(dst)) return;
    // 비허용 대상은 droppable 이 disabled 라 over 가 되지 않지만, 규칙을 한 번 더 확인해 방어한다.
    if (epicDropState(src.issue, dst.epic?.number ?? null) !== 'allowed') return;
    moveEpic.mutate({ issue: src.issue, to: dst.epic });
  }

  const value = useMemo(() => ({ activeIssue: active?.issue ?? null }), [active]);

  return (
    <IssueDndCtx.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={issueCollision}
        // 드래그 도중 임시 에픽 패널이 마운트되므로 droppable 을 계속 재측정한다.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        autoScroll={autoScroll}
        accessibility={accessibility}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActive(null)}
      >
        {children}
        {/* 행 칩은 원본 행보다 훨씬 좁아 포인터 기준으로 옮긴다 — 카드 고스트는 원본과 같은 크기라 그대로. */}
        <DragOverlay dropAnimation={null} modifiers={active?.source === 'row' ? ROW_OVERLAY_MODIFIERS : undefined}>
          {active?.source === 'card' ? (
            <IssueCard projectKey={projectKey} issue={active.issue} asOverlay showType={active.showType ?? true} />
          ) : active?.source === 'row' ? (
            <IssueRowDragChip projectKey={projectKey} issue={active.issue} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </IssueDndCtx.Provider>
  );
}

// 목록 행 드래그 고스트 — 표 행은 overlay 로 그대로 못 띄우므로 유형·키·제목 요약 칩으로 대신한다.
// 배경은 bg-popover(솔리드) — 다크의 --card 는 3% 알파라 에픽 패널 위를 지날 때 아래 글자가 비친다.
function IssueRowDragChip({ projectKey, issue }: { projectKey: string; issue: IssueResponse }) {
  return (
    <div
      className="flex max-w-80 cursor-grabbing items-center gap-1.5 rounded-md border bg-popover px-3 py-1.5 text-sm shadow-xl ring-2 ring-primary/40"
      data-testid="issue-row-drag-overlay"
    >
      {issue.type && <IssueTypeBadge type={issue.type} size="sm" iconOnly />}
      <span className="font-mono text-xs text-muted-foreground">
        {projectKey}-{issue.number}
      </span>
      <span className="min-w-0 truncate">{issue.title}</span>
    </div>
  );
}
