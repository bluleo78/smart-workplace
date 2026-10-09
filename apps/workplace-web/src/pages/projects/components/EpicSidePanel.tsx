// 왼쪽 에픽 패널 — 프로젝트의 EPIC 이슈 목록을 진행률과 함께 보여주고, 클릭한 에픽으로
// 이슈 검색을 단일 필터링한다(Jira 클래식 보드의 에픽 패널 패턴). 백엔드 변경 없이 기존
// type=EPIC 검색 + parent=<epicNumber> 필터 + childCount/childDoneCount 를 재사용한다.
// 열림/닫힘은 ViewChipBar 의 「에픽」 토글이 단일 진입점(조건 마운트).
// 항목 hover·키보드 포커스 시 ↗ 로 에픽 상세를 연다(WP-227).
// 이슈 드래그 중에는 「에픽 미할당」·각 에픽이 드롭 대상이 된다(IssueDndProvider 안일 때). floating 이면 닫힌 패널을
// 드래그 동안만 뷰포트 오른쪽에 띄우는 임시 모드.
import { useDroppable } from '@dnd-kit/core';
import { ArrowUpRight, Layers, Plus } from 'lucide-react';
import { type RefObject, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useProjectEpics } from '../../../hooks/queries/useProjectEpics';
import { presenceStyle } from '../../../lib/collab/presence';
import {
  EPIC_DROP_NONE_ID,
  EPIC_PANEL_ZONE_ID,
  epicDragBlockReason,
  type EpicDropData,
  epicDropId,
  type EpicDropState,
  epicDropState,
} from '../../../lib/epicDnd';
import type { IssueResponse, ParentRef } from '../../../types/issue';
import { useEpicFilter } from '../hooks/useEpicFilter';
import { ClosedEpicsSection } from './ClosedEpicsSection';
import { IssueCreateDialog } from './IssueCreateDialog';
import { useIssueDnd } from './IssueDndProvider';

// 패널 항목 공통 버튼 스타일.
const ITEM_BASE = 'w-full rounded px-2 py-1.5 text-left text-sm transition-colors';

export function EpicSidePanel({
  projectKey, canCreateIssue = false, floating = false,
}: { projectKey: string; canCreateIssue?: boolean; floating?: boolean }) {
  // 에픽 필터 범위(URL parent/topLevel) 읽기·쓰기는 훅이 맡는다 — 다른 필터·뷰·group 원값 보존 포함.
  const { choice, select } = useEpicFilter(projectKey);
  // 「에픽 미할당」 = 부모 없는(topLevel) 비EPIC 이슈. 유형 필터와 독립.
  const unassignedActive = choice.kind === 'unassigned';
  const selectedEpic = choice.kind === 'epic' ? choice.number : null;
  // 「＋ 에픽 만들기」 다이얼로그 열림 상태.
  const [createOpen, setCreateOpen] = useState(false);

  const { epicType, epics, loading } = useProjectEpics(projectKey);
  // 에픽 목록 스크롤 컨테이너 — 에픽 드롭 대상의 clip 으로 실어, 스크롤로 가려진 항목은 드롭 판정에서 뺀다(epicDnd).
  const listRef = useRef<HTMLDivElement>(null);

  // 드래그 상태 — provider 밖(다른 화면에서 재사용)이면 드래그 없음으로 본다.
  const dnd = useIssueDnd();
  const activeIssue = dnd?.activeIssue ?? null;
  const blockReason = activeIssue ? epicDragBlockReason(activeIssue) : null;
  // 패널 전체 영역 존 — 드래그 중에만 활성. 패널 위(비허용 항목·배너·여백)에 놓으면 no-op 이 되고 아래 보드로 새지 않는다.
  // data 에 epic 키가 없으므로 provider 의 에픽 드롭·보드 상태 모니터 모두 무시한다.
  const { setNodeRef: setZoneRef } = useDroppable({ id: EPIC_PANEL_ZONE_ID, data: { zone: true }, disabled: activeIssue == null });

  return (
    <aside
      ref={setZoneRef}
      aria-label="에픽 필터"
      data-testid="epic-side-panel"
      // 드래그 자동 스크롤 제한(IssueDndProvider)이 포인터가 패널 위인지 판정할 때 찾는 표식.
      data-epic-panel=""
      data-floating={floating || undefined}
      className={
        floating
          // 뷰포트 기준 — 긴 목록 스크롤과 무관하게 헤더(h-14) 아래 오른쪽에 뜬다.
          // 떠 있는 레이어라 솔리드 bg-popover — 다크에서는 그림자가 거의 안 보여 표면 고도로 분리한다(11-dark-mode).
          ? 'fixed right-4 top-24 bottom-4 z-30 flex w-56 flex-col rounded-md border bg-popover text-popover-foreground p-3 shadow-lg'
          : 'flex w-56 shrink-0 flex-col self-stretch border-r pr-3'
      }
    >
      {/* 헤더 — 레이블 + 에픽 개수. 접기 버튼 없음(진입점은 뷰 탭 바 토글). */}
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-xs font-medium text-muted-foreground">에픽</span>
        <span className="text-xs text-muted-foreground" data-testid="epic-panel-count">
          {epics.length}
        </span>
      </div>

      {/* 드래그 중 안내 — 허용이면 드롭 방법, 차단이면 사유(role=status 로 스크린리더에도 전달). */}
      {activeIssue && (
        <p
          role="status"
          data-testid={blockReason ? 'epic-drop-blocked-reason' : 'epic-drop-hint'}
          className={cn(
            'mb-2 rounded px-2 py-1.5 text-xs',
            blockReason ? 'bg-warning-subtle text-warning-foreground' : 'bg-primary/10 text-primary',
          )}
        >
          {blockReason ?? '에픽에 놓으면 연결됩니다'}
        </p>
      )}

      <button
        type="button"
        // 에픽 선택·미할당을 모두 해제한다.
        onClick={() => select({ kind: 'all' })}
        aria-pressed={choice.kind === 'all'}
        data-testid="epic-filter-all"
        className={cn(
          ITEM_BASE,
          choice.kind === 'all' ? 'bg-accent font-medium' : 'hover:bg-muted/50',
          // 드롭 대상이 아님 — 드래그 중에는 흐려 놓을 수 있는 항목과 구분한다.
          activeIssue && 'opacity-50',
        )}
      >
        전체 이슈
      </button>

      {epicType && (
        <UnassignedButton active={unassignedActive} activeIssue={activeIssue} onClick={() => select({ kind: 'unassigned' })} />
      )}

      <div className="my-2 border-t" />

      {/* 에픽 목록 — 내부 스크롤(헤더/고정 항목/푸터는 고정). */}
      <div
        ref={listRef}
        data-testid="epic-panel-list"
        className="min-h-0 flex-1 space-y-1 overflow-y-auto"
      >
        {loading ? (
          <div className="space-y-3 px-2 py-2" data-testid="epic-panel-skeleton">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-2 w-2 rounded-full motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                </div>
                <Skeleton className="ml-4 h-1 w-full rounded-full motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : epics.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-10 text-center" data-testid="epic-panel-empty">
            {/* 빈 상태 — 아이콘+제목+설명(06-feedback-states §B). 다음 행동은 푸터 「＋ 에픽 만들기」. */}
            <Layers className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">진행 중인 에픽이 없습니다</p>
            <p className="text-xs text-muted-foreground">
              에픽으로 큰 작업을 묶어 진행률을 추적할 수 있습니다
            </p>
          </div>
        ) : (
          epics.map((ep) => (
            <EpicItemButton
              key={ep.number}
              projectKey={projectKey}
              epic={ep}
              selected={selectedEpic === ep.number}
              activeIssue={activeIssue}
              clip={listRef}
              onClick={() => select({ kind: 'epic', number: ep.number })}
            />
          ))
        )}
        {/* 종료된 에픽(WP-245) — 드롭 대상이 아니므로 드래그 중에는 숨긴다. 로딩 중에도 숨겨 스켈레톤 아래 깜빡임을 막는다.
          마운트는 유지해 사용자의 펼침 상태를 드래그 후에도 보존한다(Review Focus 4). */}
        <ClosedEpicsSection
          projectKey={projectKey}
          selectedEpic={selectedEpic}
          onSelect={(n) => select({ kind: 'epic', number: n })}
          hidden={!!activeIssue || loading}
        />
      </div>

      {/* 푸터 — 빈 상태의 "다음 행동"이자 상시 생성 진입점. 생성 권한 + EPIC 유형이 있을 때만. */}
      {canCreateIssue && epicType && (
        <div className="mt-2 border-t pt-2">
          <button
            type="button"
            data-testid="epic-create-button"
            onClick={() => setCreateOpen(true)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50',
              activeIssue && 'opacity-50',
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> 에픽 만들기
          </button>
          <IssueCreateDialog
            projectKey={projectKey}
            open={createOpen}
            onOpenChange={setCreateOpen}
            initialTypeId={epicType.id}
          />
        </div>
      )}
    </aside>
  );
}

// 패널 항목을 에픽 드롭 대상으로 만든다 — 허용 상태일 때만 활성(비허용은 over 가 되지 않아 놓아도 무시).
// clip: 항목을 감싼 스크롤 컨테이너(에픽 목록만) — 가려진 항목이 포인터 판정에 잡히지 않게 한다.
function useEpicDroppable(
  epic: ParentRef | null,
  activeIssue: IssueResponse | null,
  clip?: RefObject<HTMLElement | null>,
) {
  const state = epicDropState(activeIssue, epic?.number ?? null);
  const { setNodeRef, isOver } = useDroppable({
    id: epic ? epicDropId(epic.number) : EPIC_DROP_NONE_ID,
    data: { epic, clip } satisfies EpicDropData,
    disabled: state !== 'allowed',
  });
  const dropState = state === 'allowed' && isOver ? 'over' : state;
  return { setNodeRef, dropState, dropClass: DROP_CLASS[dropState] };
}

// 드롭 상태별 항목 스타일 — 점선=놓을 수 있음, 실선+진한 배경=지금 놓으면 여기로, 흐림=현재/차단.
// 점선은 알파 없는 outline-primary — /60 은 비텍스트 대비 3:1 미달(라이트 ~2.96, 다크 ~2.76). 오버와는 선 모양·두께·배경으로 구분.
const DROP_CLASS: Record<EpicDropState | 'over', string> = {
  idle: '',
  allowed: 'outline-dashed outline-1 -outline-offset-1 outline-primary bg-primary/5',
  over: 'outline outline-2 -outline-offset-2 outline-primary bg-primary/15',
  current: 'opacity-50',
  blocked: 'opacity-50',
};

// 드롭 대상 항목(미할당·에픽) 공통 클래스 — 드래그 중에는 선택 배경보다 드롭 상태 표시가 우선.
function dropItemClass(selected: boolean, activeIssue: IssueResponse | null, dropClass: string) {
  return cn(ITEM_BASE, !activeIssue && (selected ? 'bg-accent font-medium' : 'hover:bg-muted/50'), dropClass);
}

// 「에픽 미할당」 버튼 — 클릭은 미할당 필터 토글, 드래그 중에는 부모 해제 드롭 대상.
function UnassignedButton({
  active, activeIssue, onClick,
}: { active: boolean; activeIssue: IssueResponse | null; onClick: () => void }) {
  const { setNodeRef, dropState, dropClass } = useEpicDroppable(null, activeIssue);
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid="epic-filter-unassigned"
      data-drop-state={dropState}
      className={dropItemClass(active, activeIssue, dropClass)}
    >
      에픽 미할당
    </button>
  );
}

// 에픽 항목 — 버튼 클릭은 해당 에픽 필터 토글, 드래그 중에는 그 에픽으로 연결하는 드롭 대상.
// hover·키보드 포커스 시 오른쪽 개수 자리를 ↗ 상세 링크로 바꾼다(WP-227) — 버튼 안에 링크를 둘 수 없어 형제로 겹쳐 둔다.
function EpicItemButton({
  projectKey, epic: ep, selected, activeIssue, clip, onClick,
}: {
  projectKey: string;
  epic: IssueResponse;
  selected: boolean;
  activeIssue: IssueResponse | null;
  clip: RefObject<HTMLElement | null>;
  onClick: () => void;
}) {
  // 검색 응답은 type 이 항상 채워진다 — 낙관적 반영에 쓸 ParentRef 로 좁힌다.
  const { setNodeRef, dropState, dropClass } = useEpicDroppable(
    { number: ep.number, title: ep.title, type: ep.type! },
    activeIssue,
    clip,
  );
  const pct = ep.childCount > 0 ? Math.round((ep.childDoneCount / ep.childCount) * 100) : 0;
  // 에픽 색점 — 사람 색 토큰을 번호 기준으로 빌려 쓴다(이전 Tailwind 팔레트 시절부터 아바타 팔레트를 공유, WP-318). 바탕만 쓴다.
  const colorStyle = presenceStyle(ep.number);
  // 드래그 중에는 상세 링크를 감춘다 — 드롭 상태 표시가 우선이고, 링크가 드롭 대상 위를 가리지 않게.
  const showDetailLink = !activeIssue;
  return (
    <div className="group relative">
      <button
        ref={setNodeRef}
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        data-testid={`epic-filter-${ep.number}`}
        data-drop-state={dropState}
        // 포인터가 겹쳐 둔 ↗ 링크 위로 가도 행 hover 배경이 유지되게 group-hover 를 더한다.
        // 터치 기기(≥1024px 태블릿, pointer-coarse — messageToolbar 와 같은 판정)는 ↗ 를 상시 노출하므로 오른쪽을 비워 개수와 겹치지 않게 한다.
        className={cn(
          dropItemClass(selected, activeIssue, dropClass),
          showDetailLink && !selected && 'group-hover:bg-muted/50',
          showDetailLink && 'pointer-coarse:pr-8',
        )}
      >
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-presence" style={colorStyle} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" title={ep.title}>{ep.title}</span>
          {/* 드래그 중인 이슈가 이미 속한 에픽 — 놓아도 변화가 없음을 알린다. */}
          {dropState === 'current' && <span className="text-xs text-muted-foreground">현재</span>}
          {/* 개수 — hover·키보드 포커스 동안은 같은 자리에 ↗ 링크가 대신 보인다(제목 폭 손실 없음). */}
          <span
            className={cn(
              'text-xs text-muted-foreground',
              showDetailLink && 'group-hover:invisible group-kbd:invisible',
            )}
          >
            {ep.childDoneCount}/{ep.childCount}
          </span>
        </span>
        {/* 진행바 — FreshnessBar 패턴(h-1 rounded-full bg-muted 트랙 + 색 채움). button 내부라 span 만 사용. */}
        <span
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-1.5 ml-4 block h-1 overflow-hidden rounded-full bg-muted"
        >
          <span className="block h-full rounded-full bg-presence" style={{ ...colorStyle, width: `${pct}%` }} />
        </span>
      </button>
      {showDetailLink && (
        // 평소엔 투명 + 포인터 무시(개수 자리 클릭은 행 필터로) — hover·키보드 포커스(group-kbd) 때 보인다.
        // invisible 이 아닌 opacity 로 감춘다: Tab 이동 순간 버튼 blur 로 group-kbd 가 풀려 invisible 링크는 건너뛰어진다.
        // 터치 기기는 group-hover 가 안 걸리므로 상시 노출한다(개수는 그대로, 버튼 pr-8 로 자리 확보).
        // 터치에선 ::after 로 사방 10px 넓혀 보이는 24px 를 터치 영역 44px 로 맞춘다(레이아웃 그대로).
        <Link
          to={`/projects/${projectKey}/issues/${ep.number}`}
          aria-label={`${ep.title} 상세 열기`}
          title="에픽 상세 열기"
          data-testid={`epic-open-${ep.number}`}
          className="pointer-events-none absolute right-1 top-1 flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 group-kbd:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']"
        >
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
