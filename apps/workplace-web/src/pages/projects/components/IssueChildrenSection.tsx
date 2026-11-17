// 비SUBTASK 이슈의 자식 SUBTASK 영역(Phase 4a) + EPIC 이슈의 하위 이슈 영역(EPIC 계층 확장).
// 진행률(완료/전체) + 자식 리스트 + 인라인 추가 폼.
// parentTypeName === 'EPIC' 이면 추가 폼에 유형 선택(SUBTASK/EPIC 제외)이 노출되고,
// 그 외(일반 이슈)는 기존처럼 SUBTASK 고정 추가 폼을 사용한다.
// 하위는 에픽·일반 이슈 모두 하위 목록 API(/children)로 받는다(WP-1684 — 예전 하위 태스크의 검색 100건 한계를 함께 푼다).
// 에픽 하위는 다른 프로젝트에도 있을 수 있어(WP-1038) 다른 프로젝트 하위는 그 프로젝트로 이어지며, 조회자가 읽을 수 없는 하위는 「볼 수 없는 하위 N건」 한 줄로만 센다(WP-1039).
// 하위가 많으면 남은 일이 끝에 묻혀(WP-1684) 열린 하위만 기본으로 보이고, 끝난 하위(완료·취소 범주)는 「완료 n건」 한 줄로 접어 누를 때 받는다. 둘 다 100건씩 「더 보기」.

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { AiDelegationBadge, delegationState } from '@/components/ai/agentWork/AiDelegationBadge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { keepFocusProps } from '@/lib/keepFocus';

import { issuesApi } from '../../../api/issues';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { issueKeys } from '../../../hooks/queries/useIssues';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { projectOverviewKey } from '../../../hooks/queries/useProjectOverview';
import { useProject } from '../../../hooks/queries/useProjects';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { handleApiError } from '../../../lib/api-error';
import { isClosedStatus } from '../../../lib/issueGrouping';
import { formatIssueKey } from '../../../lib/issueKey';
import { getIssueTypeLabel } from '../../../lib/issueTypeLabels';
import { isIntakeOnly } from '../../../lib/projectPermissions';
import type { ChildrenState, IssueResponse } from '../../../types/issue';
import { IssueStatusBadge } from './IssueStatusBadge';

/** 하위 목록 한 페이지 크기 — 예전 하위 태스크 검색과 같은 100건(WP-1684). */
const CHILDREN_PAGE_SIZE = 100;

/**
 * 하위 목록 한 갈래(열린/끝난)를 100건씩 받는 무한 조회(WP-1684).
 * 키는 issueKeys.children 접두(검색 접두 아래) + state — 하위 추가·상태 변경·부모 변경이 쓰는 검색 접두 무효화에 열린·끝난 목록이 함께 갱신된다.
 * 페이지 모양({ items, … })이 검색 응답과 같아, 검색 캐시를 훑는 낙관적 패치(상태 배지 등)도 그대로 닿는다.
 */
function useChildrenPages(projectKey: string, parentNumber: number, state: ChildrenState, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...issueKeys.children(projectKey, parentNumber), state],
    queryFn: ({ pageParam }) =>
      issuesApi.children(projectKey, parentNumber, { state, cursor: pageParam, size: CHILDREN_PAGE_SIZE }),
    initialPageParam: null as string | null,
    // 구 응답(nextCursor 없음)·빈 응답이면 다음 페이지 없음.
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
    enabled: enabled && !!projectKey && Number.isFinite(parentNumber),
  });
}

/** 받은 페이지들을 서버 순서((created_at, id) 오름차순) 그대로 이어 붙인다. */
function flattenPages(pages: { items?: IssueResponse[] }[] | undefined): IssueResponse[] {
  return (pages ?? []).flatMap((p) => p?.items ?? []);
}

/** 하위 한 줄 — 유형·키·제목 링크·배지(행당 하나). 열린·끝난 목록이 같은 모양을 쓴다. */
function ChildRow({ it, projectKey }: { it: IssueResponse; projectKey: string }) {
  // 행당 배지는 최대 1개(WP-374) — 열린 행에 AI 배지(진행·시작 전·위임)가 있으면 상태배지 대신 그것,
  // 그 외(끝난 행·AI 관여 없는 열린 행)는 상태배지. 할 일/진행 중 구분은 진행률 바로 알 수 없어 남긴다.
  const showAi = !isClosedStatus(it.status) && delegationState(it) !== null;
  // 키는 늘 제목 앞에 전체 키(WP-12)로 보인다(WP-1635) — 제목만으로는 어느 이슈인지 알 수 없고, 검색·비교에 쓰는 형태 그대로 보인다.
  // 다른 프로젝트 하위(WP-1039)는 그 프로젝트 키로 보이고 그 프로젝트로 잇는다.
  const childKey = it.projectKey || projectKey;
  const otherProject = childKey !== projectKey;
  const issueKey = formatIssueKey(childKey, it.number);
  return (
    <li
      className="flex items-center gap-2 rounded px-1 text-sm hover:bg-accent/50"
      data-testid={otherProject ? `child-row-${issueKey}` : `child-row-${it.number}`}
    >
      <span className="text-muted-foreground">└</span>
      {it.type && <IssueTypeBadge type={it.type} size="sm" iconOnly />}
      {/* 키는 텍스트 — 행의 링크는 제목 하나만(탭 순서·스크린리더 중복 방지). */}
      <span className="shrink-0 font-mono text-xs text-muted-foreground" data-testid="child-row-key">
        {issueKey}
      </span>
      <Link
        to={`/projects/${childKey}/issues/${it.number}`}
        className="min-w-0 flex-1 truncate hover:underline"
      >
        {it.title}
      </Link>
      {showAi ? <AiDelegationBadge issue={it} /> : <IssueStatusBadge status={it.status} name={it.statusName} />}
    </li>
  );
}

/** 목록 끝 「더 보기」 — 다음 페이지가 있을 때만, 받는 동안은 잠근다. */
function MoreButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="px-1 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
      >
        {loading ? '불러오는 중…' : '더 보기'}
      </button>
    </li>
  );
}

export function IssueChildrenSection({
  projectKey,
  parentNumber,
  parentTypeName,
  parentStatus,
  childCount,
  childDoneCount,
}: {
  projectKey: string;
  parentNumber: number;
  parentTypeName: string;
  parentStatus: string;
  childCount: number;
  childDoneCount: number;
}) {
  const qc = useQueryClient();
  const types = useIssueTypes(projectKey);
  const isEpicParent = parentTypeName === 'EPIC';
  // OPEN 프로젝트 비멤버는 하위를 만들 수 없다(WP-477 — 부모·유형 지정은 멤버 전용, 서버 403) — 추가 입력을 숨긴다.
  const intakeOnly = isIntakeOnly(useProject(projectKey).data);
  // 완료(DONE) 에픽에는 미완료 하위를 넣을 수 없다(WP-689, 서버 400) — 추가 입력 대신 다시 열라는 안내를 둔다.
  const doneEpic = isEpicParent && parentStatus === 'DONE';
  // 일반 이슈(비EPIC) 부모 — SUBTASK 시스템 유형의 id (인라인 생성에 필요).
  const subtaskTypeId =
    (types.data ?? []).find((t) => t.name === 'SUBTASK')?.id ?? null;
  // EPIC 부모 — 하위 이슈로 선택 가능한 유형(SUBTASK/EPIC 제외, 2단 초과 금지).
  const epicChildTypes = (types.data ?? []).filter(
    (t) => t.name !== 'SUBTASK' && t.name !== 'EPIC',
  );
  const [epicChildTypeId, setEpicChildTypeId] = useState<number | null>(null);

  // EPIC 유형 목록 로드 시 첫 항목(TASK 우선 정렬) 기본 선택.
  useEffect(() => {
    if (!isEpicParent || epicChildTypeId != null || epicChildTypes.length === 0) return;
    setEpicChildTypeId(epicChildTypes[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEpicParent, epicChildTypes.length]);

  // 열린 하위 — 섹션을 열면 바로 받는다. closedCount·hiddenCount 는 페이지와 상관없이 전체 기준이라 첫 페이지 값을 쓴다.
  const children = useChildrenPages(projectKey, parentNumber, 'open', true);
  // 「완료 n건」 펼침 — 이 부모에서 펼쳤을 때만 참. 다른 이슈로 옮겨 가면(같은 섹션 인스턴스가 남아도) 다시 접힌다 — 접힘 상태는 기억하지 않는다.
  const parentId = `${projectKey}-${parentNumber}`;
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const closedExpanded = expandedFor === parentId;
  // 끝난 하위 — 펼쳤을 때만 받는다(하위가 수백 건인 에픽도 상세가 빨리 열리게).
  const closedChildren = useChildrenPages(projectKey, parentNumber, 'closed', closedExpanded);

  // 서버가 (created_at, id) 오름차순으로 주므로 새 하위는 아래로 쌓인다(refs #166) — 다시 정렬하지 않는다.
  const items: IssueResponse[] = flattenPages(children.data?.pages);
  const closedItems: IssueResponse[] = flattenPages(closedChildren.data?.pages);
  const firstPage = children.data?.pages[0];
  // 읽을 수 없는 프로젝트의 하위 수 — 진행률(childCount)은 이것까지 세므로 목록 아래 한 줄로 수를 맞춘다.
  const hiddenCount = firstPage?.hiddenCount ?? 0;
  // 볼 수 있는 끝난 하위 수 — 진행률과 달리 볼 수 없는 하위는 세지 않는다(차이는 「볼 수 없는 하위 N건」이 보인다).
  const closedCount = firstPage?.closedCount ?? 0;
  const [newTitle, setNewTitle] = useState('');
  // 모바일(WP-196): 「＋ 하위 태스크 추가」 탭으로 입력칸을 펼치는 연속 입력 UX. 데스크톱은 입력칸이 항상 보인다.
  const isMobile = useIsMobile();
  const [addOpen, setAddOpen] = useState(false);
  // 포커스 후 가운데 스크롤 타이머 — blur·언마운트 시 취소해 이미 떠난 입력칸으로 화면을 끌어오지 않는다.
  const scrollTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(scrollTimerRef.current), []);
  // 모바일: 유형 셀렉트를 누른 순간의 입력칸 blur 는 폼 밖으로 나간 게 아니다(WP-653). iOS Safari 는 버튼에 포커스를 주지 않아
  // relatedTarget 이 비어 「빈 채로 밖을 눌렀다」로 보이므로, 누름을 표시해 두고 다음 blur 한 번 또는 셀렉트가 닫힐 때 지운다.
  const typePressRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // 인라인 추가 — 제목 입력, 유형은 EPIC 부모면 선택된 값/일반 부모면 SUBTASK 고정, parentNumber 동봉.
  // 보낸 제목은 요청 전에 바로 비운다 — 응답을 기다리는 동안 친 다음 제목을 응답 처리가 지우지 않게 하고(WP-467),
  // 응답을 기다리지 않고 이어서 Enter 로 다음 제목을 보낼 수 있게 한다(제출 버튼을 잠그면 Enter 제출도 막힌다).
  async function onAdd() {
    const t = newTitle.trim();
    const typeId = isEpicParent ? epicChildTypeId : subtaskTypeId;
    if (!t || !typeId) return;
    // 모바일 연속 입력 — 추가 버튼은 포커스를 빼앗지 않으므로(keepFocusProps) 입력칸·키보드가 그대로 남는다.
    setNewTitle('');
    try {
      await issuesApi.create(projectKey, {
        title: t,
        typeId,
        parentNumber,
      });
      // 자식 목록, 검색 캐시, 부모 detail 의 childCount 모두 갱신.
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      // 하위 이슈도 개요의 열린 이슈 수·생성 수에 들어가므로 개요도 무효화한다(WP-1652).
      qc.invalidateQueries({ queryKey: projectOverviewKey(projectKey) });
      toast.success(isEpicParent ? '하위 이슈를 추가했습니다' : '하위 태스크를 추가했습니다');
    } catch (e) {
      // 실패한 제목을 되돌려 다시 보낼 수 있게 한다 — 그 사이 다음 제목을 치고 있었다면 그것을 지우지 않는다.
      setNewTitle((cur) => (cur ? cur : t));
      handleApiError(e, '하위 이슈 추가에 실패했습니다');
    }
  }

  const pct = childCount === 0 ? 0 : Math.round((childDoneCount / childCount) * 100);
  const sectionLabel = isEpicParent ? '하위 이슈' : '하위 태스크';

  return (
    <section
      aria-label={sectionLabel}
      data-testid="issue-children-section"
      className="space-y-2"
    >
      <div className="flex items-center gap-2">
        {/* 섹션 헤딩 — 디자인 시스템 heading-group(H4) 토큰. */}
        <h3 className="text-base leading-6 font-medium">{sectionLabel}</h3>
        {/* 개수만 노출 — 하위 이슈가 있을 때만(0/0 은 무의미). */}
        {childCount > 0 && (
          <span className="text-xs text-muted-foreground" data-testid="child-progress-text">
            {childDoneCount}/{childCount}
          </span>
        )}
        {/* 진행률 트랙 — 하위 이슈가 있을 때만. 0/0 일 때 빈 회색 트랙이 우측에 divider 처럼 보이는 문제 제거. */}
        {childCount > 0 && (
          <div className="flex-1 bg-muted h-1 rounded overflow-hidden">
            <div
              className="bg-primary h-full"
              style={{ width: `${pct}%` }}
              data-testid="child-progress-bar"
            />
          </div>
        )}
      </div>

      {children.isLoading ? (
        <p className="text-xs text-muted-foreground">로딩 중…</p>
      ) : children.isLoadingError ? (
        // 목록을 못 불러오면 진행률(「2/3」)과 빈 목록이 어긋나 보인다 — 실패를 알리고 다시 시도를 준다(WP-858).
        <p role="alert" className="text-xs text-destructive" data-testid="children-load-error">
          하위 이슈를 불러오지 못했습니다.{' '}
          <button type="button" className="underline" onClick={() => void children.refetch()}>
            다시 시도
          </button>
        </p>
      ) : items.length === 0 && hiddenCount === 0 && closedCount === 0 ? null : (
        <>
          {(items.length > 0 || hiddenCount > 0) && (
            <ul className="space-y-1">
              {items.map((it) => (
                <ChildRow key={it.id} it={it} projectKey={projectKey} />
              ))}
              {children.hasNextPage && (
                <MoreButton onClick={() => void children.fetchNextPage()} loading={children.isFetchingNextPage} />
              )}
              {/* 읽을 수 없는 프로젝트의 하위 — 제목·키 없이 수만(서버가 싣지 않는다). */}
              {hiddenCount > 0 && (
                <li className="flex items-center gap-2 px-1 text-sm text-muted-foreground" data-testid="child-hidden-count">
                  <span>└</span>
                  볼 수 없는 하위 {hiddenCount}건
                </li>
              )}
            </ul>
          )}
          {/* 끝난 하위(완료·취소) — 한 줄로 접어 두고 누르면 그 아래로 펼친다. 끝난 것이 없으면 줄이 없다. */}
          {closedCount > 0 && (
            <div className="space-y-1">
              <button
                type="button"
                aria-expanded={closedExpanded}
                data-testid="children-closed-toggle"
                onClick={() => setExpandedFor(closedExpanded ? null : parentId)}
                className="flex items-center gap-0.5 rounded px-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {closedExpanded ? (
                  <ChevronDown className="size-3.5" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5" aria-hidden />
                )}
                완료 {closedCount}건
              </button>
              {closedExpanded &&
                (closedChildren.isLoading ? (
                  <p className="px-1 text-xs text-muted-foreground">로딩 중…</p>
                ) : closedChildren.isLoadingError ? (
                  <p role="alert" className="px-1 text-xs text-destructive" data-testid="children-closed-load-error">
                    끝난 하위 이슈를 불러오지 못했습니다.{' '}
                    <button type="button" className="underline" onClick={() => void closedChildren.refetch()}>
                      다시 시도
                    </button>
                  </p>
                ) : (
                  <ul className="space-y-1" data-testid="children-closed-list">
                    {closedItems.map((it) => (
                      <ChildRow key={it.id} it={it} projectKey={projectKey} />
                    ))}
                    {closedChildren.hasNextPage && (
                      <MoreButton
                        onClick={() => void closedChildren.fetchNextPage()}
                        loading={closedChildren.isFetchingNextPage}
                      />
                    )}
                  </ul>
                ))}
            </div>
          )}
        </>
      )}

      {intakeOnly ? null : doneEpic ? (
        <p className="text-xs text-muted-foreground" data-testid="child-add-done-epic-hint">
          완료된 에픽에는 하위 이슈를 추가할 수 없습니다. 에픽을 다시 열면 추가할 수 있습니다.
        </p>
      ) : isMobile && !addOpen ? (
        <button
          type="button"
          data-testid="child-add-open"
          onClick={() => setAddOpen(true)}
          className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-sm text-muted-foreground active:bg-accent"
        >
          <Plus className="size-4" aria-hidden /> {isEpicParent ? '하위 이슈 추가' : '하위 태스크 추가'}
        </button>
      ) : (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd();
        }}
        className="flex gap-2"
        data-testid="child-add-form"
      >
        {isEpicParent && (
          <Select
            value={epicChildTypeId != null ? String(epicChildTypeId) : ''}
            onOpenChange={(open) => {
              if (!open) typePressRef.current = false;
            }}
            onValueChange={(v) => {
              // Radix Select 의 hidden native <select> 폴백이 마운트 시 value="" 로
              // onValueChange 를 한 번 발화시켜 Number('')=0 이 state 에 들어가는 문제 방지.
              if (v) setEpicChildTypeId(Number(v));
            }}
          >
            <SelectTrigger
              onPointerDown={
                isMobile
                  ? () => {
                      typePressRef.current = true;
                    }
                  : undefined
              }
              data-testid="epic-child-type-select"
              aria-label="하위 이슈 유형"
              className="w-32"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              // 모바일: 유형을 고른 다음 할 일은 제목 — 트리거 대신 제목칸으로 돌려 키보드가 바로 올라오게 한다.
              onCloseAutoFocus={
                isMobile
                  ? (e) => {
                      e.preventDefault();
                      titleInputRef.current?.focus();
                    }
                  : undefined
              }
            >
              {epicChildTypes.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {getIssueTypeLabel(t.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          ref={titleInputRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          // 모바일은 「Enter」 안내 대신 짧은 제목 힌트 — 좁은 폭에서 안내문이 잘렸고, 키보드의 완료 키(enterKeyHint)가 같은 역할을 한다.
          placeholder={
            isMobile
              ? isEpicParent ? '하위 이슈 제목' : '하위 태스크 제목'
              : isEpicParent
                ? '+ 하위 이슈 추가 — 제목 입력 후 Enter'
                : '+ 하위 태스크 추가 — 제목 입력 후 Enter'
          }
          enterKeyHint={isMobile ? 'done' : undefined}
          maxLength={200}
          data-testid="child-add-input"
          autoFocus={isMobile}
          // 모바일: 키보드가 올라온 뒤 입력칸이 가려지지 않게 화면 가운데로(셸이 --vvh 로 줄어드는 시간을 기다림).
          onFocus={
            isMobile
              ? (e) => {
                  const el = e.currentTarget;
                  window.clearTimeout(scrollTimerRef.current);
                  scrollTimerRef.current = window.setTimeout(() => {
                    if (document.activeElement === el) el.scrollIntoView({ block: 'center' });
                  }, 300);
                }
              : undefined
          }
          // 비운 채로 포커스를 잃으면 접는다 — 추가 버튼(submit) 탭은 relatedTarget 이 form 안이라, 유형 셀렉트 탭은 누름 표시로 유지.
          onBlur={
            isMobile
              ? (e) => {
                  window.clearTimeout(scrollTimerRef.current);
                  const pressedType = typePressRef.current;
                  typePressRef.current = false;
                  if (!pressedType && !newTitle.trim() && !e.currentTarget.form?.contains(e.relatedTarget as Node)) {
                    setAddOpen(false);
                  }
                }
              : undefined
          }
        />
        <Button
          type="submit"
          size="sm"
          // 모바일: 버튼 탭이 입력칸 blur 를 일으키지 않게(iOS 키보드 유지).
          {...(isMobile ? keepFocusProps : undefined)}
          disabled={!newTitle.trim() || !(isEpicParent ? epicChildTypeId : subtaskTypeId)}
        >
          추가
        </Button>
      </form>
      )}
    </section>
  );
}
