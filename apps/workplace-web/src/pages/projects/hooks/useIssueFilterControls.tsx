// 이슈 필터 바 로직 훅 — 데스크톱 IssueFilterBar 와 모바일 툴바가 공유한다.
// URL 의 SearchParams 가 단일 source of truth — 내부 state 는 q 입력 debounce 버퍼뿐.

import type { LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { type FacetDef, type FilterValue, QUICK_FILTER_STORAGE_PREFIX } from '@/components/filter';

import { IssuePriorityBars } from '../../../components/issues/IssuePriorityBars';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../../components/labels/LabelChip';
import { useComponents } from '../../../hooks/queries/useComponents';
import { useCycles } from '../../../hooks/queries/useCycles';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { useLabels } from '../../../hooks/queries/useLabels';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useProjectStatusList } from '../../../hooks/queries/useProjectStatuses';
import { useVersions } from '../../../hooks/queries/useVersions';
import { useAuth } from '../../../hooks/useAuth';
import { useIssueGroupBy } from '../../../hooks/useIssueGroupBy';
import { useSearchDraft } from '../../../hooks/useSearchDraft';
import { CLOSED_PRESETS, closedRangeLabel } from '../../../lib/closedRange';
import { kstDateKey } from '../../../lib/formatters';
import { clearFacetFilters, countActiveFacets } from '../../../lib/issueFacetFilters';
import {
  carryViewOptions,
  filtersToParams,
  overridesClosedHiding,
  parseFilters,
  parseView,
} from '../../../lib/issueFilters';
import { ISSUE_GROUP_BY_LABEL, ISSUE_PRIORITY_OPTIONS } from '../../../lib/issueGrouping';
import type {
  IssueFilters,
  IssueGroupBy,
  IssueGroupParam,
  IssueView,
} from '../../../types/issue';
import { ClosedRangeExtra } from '../components/ClosedRangeExtra';
import { assigneeFacetValue, assigneeFilterFromFacet, buildAssigneeFacet } from './assigneeFacet';
import { buildComponentFacet, componentFacetValue, componentFilterFromFacet } from './componentFacet';
import { buildStatusFacets } from './statusFacets';
import { buildVersionFacet, versionFacetValue, versionFilterFromFacet } from './versionFacet';

// 그룹 기준 옵션 (#58). null = 그룹 없음(평탄 리스트 / 상태 보드).
// 사이클(#878)은 팀 목록 전용 — 보드·사이클 비사용 화면에선 목록에서 빠진다(아래 visibleGroupOptions).
// 라벨은 ISSUE_GROUP_BY_LABEL 공용 맵에서 — AI 화면 컨텍스트(WP-54)와 같은 문구를 쓴다(키 순서 = 옵션 순서).
const GROUP_OPTIONS: { value: IssueGroupBy | null; label: string }[] = [
  { value: null, label: '없음' },
  ...(Object.entries(ISSUE_GROUP_BY_LABEL) as [IssueGroupBy, string][]).map(([value, label]) => ({ value, label })),
];

// 빠른 필터 칩 기본 목록(WP-1020) — 팀 목록은 자주 쓰는 다섯 개를 칩으로 바로 보이고 나머지(상태 범주·사이클·완료일·구성요소·버전)는 「더 보기」.
// 「상태」는 프로젝트 상태(statusId) facet 이다 — 「상태 범주」(status)는 덜 쓰여 「더 보기」로 간다.
export const TEAM_QUICK_CHIPS: readonly string[] = ['assignee', 'statusId', 'type', 'label', 'priority'];

// 개인 프로젝트 등에서 일부 컨트롤을 숨기거나 라벨을 바꾸기 위한 옵션. 기본값 = 팀 전체 동작.
export interface IssueFilterBarOptions {
  showCycle?: boolean; // 기본 true
  showType?: boolean; // 기본 true
  showClosedToggle?: boolean; // 「완료 모두 보기」 노출. 기본 true — 종료 이슈 숨김 범위를 안 쓰는 화면(개인)은 false
  showClosedFilter?: boolean; // 「완료일」 기간 필터 facet 노출(WP-873). 기본 true — 종료 이슈 기능을 안 쓰는 화면(개인)은 false
  showColumnPicker?: boolean; // 목록 「▦ 열」 메뉴 노출(WP-270). 기본 true — 목록이 이슈 표가 아닌 화면(개인 체크리스트)은 false
  groupOptions?: { value: IssueGroupBy | null; label: string }[]; // 기본 GROUP_OPTIONS
  listLabel?: string; // 뷰토글의 'list' 버튼 접근성 라벨. 기본 '리스트'
  listIcon?: LucideIcon; // 뷰토글의 'list' 버튼 아이콘. 기본 List(목록). 개인=ListChecks(체크리스트)
  quickChips?: readonly string[]; // 빠른 필터 기본 칩(facet key, 순서대로). 기본 TEAM_QUICK_CHIPS — 개인 = 상태·우선순위
  quickFilterScreen?: string; // 칩 고정·숨김 저장 키의 화면 이름. 기본 'project-issues' — 개인 화면은 따로 기억한다
}


// 훅이 노출하는 필터 컨트롤 — 소비자(데스크톱 바/모바일 툴바)는 이 값만 쓴다.
export interface IssueFilterControls {
  filters: IssueFilters;
  view: IssueView;
  groupParam: IssueGroupParam | null; // URL 원값
  groupBy: IssueGroupBy | null; // 적용 중(사이클 기본값 반영)
  qDraft: string;
  setQDraft: (q: string) => void; // 300ms debounce 후 URL q
  facets: FacetDef[];
  filterValue: FilterValue;
  onFilterChange: (next: FilterValue) => void;
  activeFilterCount: number; // 값이 있는 facet 수(q 제외)
  hasActiveFilters: boolean; // q 포함
  setView: (v: IssueView) => void;
  setGroupBy: (g: IssueGroupBy | null) => void;
  visibleGroupOptions: { value: IssueGroupBy | null; label: string }[];
  reset: () => void;
  showClosedToggle: boolean;
  closedHidingOverridden: boolean;
  toggleShowAllClosed: () => void;
  clearFacets: () => void; // q·view·group 유지, facet 값만 비움
  quickChips: readonly string[]; // 빠른 필터 기본 칩
  quickFilterStorageKey: string | undefined; // 칩 고정·숨김 저장 키(화면·사용자별). 로그인 정보가 없으면 undefined(기억 안 함)
}

export function useIssueFilterControls(
  projectKey: string,
  options?: IssueFilterBarOptions,
): IssueFilterControls {
  const showCycle = options?.showCycle ?? true;
  const showType = options?.showType ?? true;
  const showClosedToggle = options?.showClosedToggle ?? true;
  const showClosedFilter = options?.showClosedFilter ?? true;
  const groupOptions = options?.groupOptions ?? GROUP_OPTIONS;
  const quickChips = options?.quickChips ?? TEAM_QUICK_CHIPS;
  // 칩 고정·숨김은 화면·사용자별로 기억한다 — 한 브라우저를 여러 계정이 써도 서로 섞이지 않게 사용자 id 를 키에 넣는다.
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const quickFilterStorageKey =
    meId == null ? undefined : `${QUICK_FILTER_STORAGE_PREFIX}${options?.quickFilterScreen ?? 'project-issues'}:${meId}`;
  const [params, setParams] = useSearchParams();
  // params 는 URL(search)이 바뀔 때만 새 객체 — 파싱 결과를 메모해 아래 filterValue 메모가 매 렌더 깨지지 않게 한다.
  const filters = useMemo(() => parseFilters(params), [params]);
  const view = parseView(params);
  // groupParam = URL 원값(부재/none/값) — 필터를 다시 쓸 때 그대로 보존해야 명시한 「없음」이 기본값으로 되돌지 않는다.
  // groupBy = 실제 적용 중인 그룹(사이클 기본값 반영) — 셀렉트 표시용.
  const { raw: groupParam, groupBy } = useIssueGroupBy(projectKey, showCycle);
  const labels = useLabels(projectKey);
  // 구성요소(WP-933) — 사용 중인 것이 있을 때만 facet 이 생긴다. 개인 화면(showType=false)은 구성요소가 없어 요청하지 않는다.
  const components = useComponents(projectKey, { enabled: showType });
  // 버전(WP-888) — 보관 안 된 버전이 있을 때만 「수정 버전」·「영향 버전」 facet 이 생긴다. 개인 화면은 버전이 없어 요청하지 않는다.
  const versions = useVersions(projectKey, { enabled: showType });
  // useCycles/useIssueTypes/useProjectMembers 는 훅 규칙상 항상 호출하지만,
  // showCycle/showType=false 면 렌더하지 않는다(개인 프로젝트). 네트워크는 발생하나 결과가 비어 무해.
  const cycles = useCycles(projectKey);
  const types = useIssueTypes(projectKey);
  // 프로젝트 멤버 목록 — 담당자 필터 facet 옵션 구성에 사용.
  const members = useProjectMembers(projectKey);
  // 프로젝트 상태(표시 순서) — 「상태」 facet 옵션. 로딩 중엔 빈 배열이라 고를 값이 없다.
  const projectStatuses = useProjectStatusList(projectKey);

  // 검색어 draft — 300ms debounce 후 URL 에 반영해 매 키 입력마다 네트워크 호출을 막는다.
  // URL 의 q 가 외부 변경(예: 초기화 버튼)으로 바뀌면 입력값을 맞추고, 내가 쓴 q 가 되돌아올 때는
  // 그 사이 더 친 글자를 덮지 않는다 — 연락처·메일과 같은 공용 훅(WP-1003). 쓰는 순간의 최신 필터·view·group 에 q 만 바꾼다.
  const { draft: qDraft, setDraft: setQDraft } = useSearchDraft(filters.q, (q) =>
    writeFilters({ ...filters, q }, view, groupParam),
  );

  // view·groupBy 는 IssueFilters 와 분리된 URL 키 — 필터 변경 시에도 함께 보존해야 한다.
  function writeFilters(
    next: IssueFilters,
    nextView: IssueView,
    nextGroupBy: IssueGroupParam | null,
  ) {
    setParams((prev) => carryViewOptions(filtersToParams(next, nextView, nextGroupBy), prev), { replace: true });
  }

  function setView(v: IssueView) {
    writeFilters(filters, v, groupParam);
  }

  // 그룹 기준 변경 — 필터/view 는 유지하고 group 만 교체 (#58).
  // 「없음」은 group=none 으로 명시한다 — 키를 지우면 사이클이 있는 프로젝트는 기본 사이클 그룹으로 되돌아간다(#878).
  function setGroupBy(g: IssueGroupBy | null) {
    writeFilters(filters, view, g ?? 'none');
  }

  // 초기화는 view·group(과 보드 탭·목록 열 구성)은 유지하고 나머지 필터만 비운다.
  function reset() {
    setParams((prev) => {
      const p = new URLSearchParams();
      if (view === 'board') p.set('view', 'board');
      if (groupParam) p.set('group', groupParam);
      return carryViewOptions(p, prev);
    }, { replace: true });
  }

  // 셀렉트에 보일 그룹 옵션 — 사이클 그룹은 사이클을 쓰는 화면의 목록 뷰에서만 고를 수 있다.
  const visibleGroupOptions = groupOptions.filter(
    (o) => o.value !== 'cycle' || (showCycle && view === 'list'),
  );

  // 명시 필터가 이미 종료 이슈 숨김을 해제했는지 — 토글 표시 상태에 반영(#876).
  const closedHidingOverridden = overridesClosedHiding(filters);

  // 적용된 필터(검색어 포함)가 하나라도 있을 때만 데스크톱 「필터 지우기」를 노출 — 평소엔 숨겨 툴바를 깔끔하게.
  const hasActiveFilters =
    filters.q !== '' ||
    filters.statuses.length > 0 ||
    filters.statusIds.length > 0 ||
    filters.priorities.length > 0 ||
    filters.labelIds.length > 0 ||
    filters.cycleIds.length > 0 ||
    filters.componentIds.length > 0 ||
    filters.componentNone ||
    filters.fixVersionIds.length > 0 ||
    filters.fixVersionNone ||
    filters.affectsVersionIds.length > 0 ||
    filters.affectsVersionNone ||
    filters.typeIds.length > 0 ||
    filters.assigneeIds.length > 0 ||
    filters.includeUnassigned ||
    filters.closedIn != null;

  // URL filters → 범용 FilterValue. 상태 범주/우선순위는 문자열, 상태/라벨/사이클/유형/담당자는 숫자 id.
  const filterValue: FilterValue = useMemo(
    () => ({
      statusId: filters.statusIds,
      status: filters.statuses,
      priority: filters.priorities,
      label: filters.labelIds,
      cycle: filters.cycleIds,
      // 구성요소 — id 와 「구성요소 없음」('none')을 한 facet 값으로.
      component: componentFacetValue(filters.componentIds, filters.componentNone),
      // 수정 버전·영향 버전 — 구성요소처럼 id 와 「없음」('none')을 한 facet 값으로.
      fixVersion: versionFacetValue(filters.fixVersionIds, filters.fixVersionNone),
      affectsVersion: versionFacetValue(filters.affectsVersionIds, filters.affectsVersionNone),
      type: filters.typeIds,
      // 담당자 — id 와 「미지정」('none', URL assignee=null)을 한 facet 값으로(WP-1020).
      assignee: assigneeFacetValue(filters.assigneeIds, filters.includeUnassigned),
      // 완료일 기간은 토큰 하나(프리셋 또는 'from~to') — 단일 선택 facet.
      closedIn: filters.closedIn ? [filters.closedIn] : [],
    }),
    [filters],
  );

  // 구성요소 필터가 걸려 있는가 — 구성요소가 모두 보관돼도 facet 을 남겨 풀 수 있게 한다.
  const componentFilterActive = filters.componentIds.length > 0 || filters.componentNone;
  // 버전 필터가 걸려 있는가 — 버전이 모두 보관돼도 facet 을 남겨 풀 수 있게 한다.
  const fixVersionFilterActive = filters.fixVersionIds.length > 0 || filters.fixVersionNone;
  const affectsVersionFilterActive = filters.affectsVersionIds.length > 0 || filters.affectsVersionNone;

  // 「완료일」 프리셋 라벨의 기준일 — KST 오늘. 날짜가 바뀌면 라벨이 새로 계산되게 facet 메모의 의존값으로 쓴다.
  const todayKey = kstDateKey(new Date());
  // 라벨 계산 기준 시각(KST 오늘 정오) — 날짜가 바뀔 때만 새로 만든다(프리셋 라벨·선택값 라벨이 같은 값을 쓴다).
  const todayNoon = useMemo(() => new Date(`${todayKey}T12:00:00+09:00`), [todayKey]);

  // facet 정의 — 노출 여부는 showCycle/showType 옵션으로 결정.
  // 쿼리 데이터가 바뀔 때만 다시 만든다(옵션 render 노드 포함) — FacetFilter 가 매 렌더 새 배열을 받지 않게.
  const facets: FacetDef[] = useMemo(
    () => [
      // 「상태」(프로젝트 상태)·「상태 범주」(범주 4개) — 별도 facet 이고 서로는 AND 로 묶인다(WP-808).
      ...buildStatusFacets(projectStatuses),
      {
        key: 'priority',
        label: '우선순위',
        // 이슈 목록 행의 IssuePriorityBars 와 동일한 아이콘을 드롭다운 옵션에 표시해 시각 일관성 확보.
        // 선택지는 공용 5단계 목록(매우 높음→매우 낮음, WP-886) — 서버 enum·다른 화면과 같은 순서.
        options: ISSUE_PRIORITY_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          render: (
            <span className="flex items-center gap-1.5">
              <IssuePriorityBars priority={o.value} />
              {o.label}
            </span>
          ),
        })),
      },
      {
        key: 'label',
        label: '라벨',
        // 백엔드가 선택된 라벨을 AND 결합(모두 가진 이슈만)하므로 다른 facet(OR)과 구분 표시 (#626)
        combineMode: 'and',
        options: (labels.data ?? []).map((l) => ({
          value: l.id,
          label: l.name,
          render: (
            <LabelChip label={{ id: l.id, name: l.name, colorToken: l.colorToken }} size="sm" />
          ),
        })),
      },
      // 구성요소 facet(WP-933) — 사용 중 구성요소가 없으면 넣지 않는다.
      ...(showType
        ? [buildComponentFacet(components.data ?? [], componentFilterActive)].filter((f): f is FacetDef => f !== null)
        : []),
      // 수정 버전·영향 버전 facet(WP-888) — 보관 안 된 버전이 없으면 넣지 않는다. 두 필터는 서로 AND.
      ...(showType
        ? [
            buildVersionFacet('fix', versions.data ?? [], fixVersionFilterActive),
            buildVersionFacet('affects', versions.data ?? [], affectsVersionFilterActive),
          ].filter((f): f is FacetDef => f !== null)
        : []),
      // 담당자 facet — 프로젝트 멤버 목록을 옵션으로 사용(#363). 맨 위 「나」·「미지정」(WP-1020).
      buildAssigneeFacet(members.data ?? [], meId),
      // 사이클 facet — 사이클이 하나도 없으면 고를 게 없어 넣지 않는다(걸린 필터가 있으면 풀 수 있게 남긴다, WP-1020).
      ...(showCycle && ((cycles.data?.length ?? 0) > 0 || filters.cycleIds.length > 0)
        ? [
            {
              key: 'cycle',
              label: '사이클',
              options: (cycles.data ?? []).map((c) => ({ value: c.id, label: c.name })),
            } satisfies FacetDef,
          ]
        : []),
      ...(showType
        ? [
            {
              key: 'type',
              label: '유형',
              options: (types.data ?? []).map((t) => ({
                value: t.id,
                label: t.name,
                render: (
                  <IssueTypeBadge
                    type={{ id: t.id, name: t.name, colorToken: t.colorToken, icon: t.icon }}
                    size="sm"
                  />
                ),
              })),
            } satisfies FacetDef,
          ]
        : []),
      // 「완료일」 — 프리셋(날짜 범위를 라벨에 함께 보임) 또는 「기간 직접 지정」. 단일 선택이라 하나만 걸린다(WP-873).
      // 종료 이슈 기능을 옵트아웃한 화면(개인 체크리스트)에는 넣지 않는다.
      ...(showClosedFilter
        ? [
          {
            key: 'closedIn',
            label: '완료일',
            single: true,
            options: CLOSED_PRESETS.map((p) => ({
              value: p.value,
              label: closedRangeLabel(p.value, todayNoon),
            })),
            valueLabel: (v) => closedRangeLabel(String(v), todayNoon) || undefined,
            renderExtra: (args) => <ClosedRangeExtra {...args} />,
          } satisfies FacetDef,
          ]
        : []),
    ],
    [projectStatuses, labels.data, components.data, componentFilterActive, versions.data, fixVersionFilterActive, affectsVersionFilterActive, members.data, meId, cycles.data, filters.cycleIds.length, types.data, showCycle, showType, showClosedFilter, todayNoon],
  );

  // FilterValue → URL filters. 숫자 facet 값은 number 로 왕복(DOM stringify 금지).
  function onFilterChange(next: FilterValue) {
    const fixVersion = versionFilterFromFacet(next.fixVersion);
    const affectsVersion = versionFilterFromFacet(next.affectsVersion);
    writeFilters(
      {
        ...filters,
        statuses: (next.status ?? []) as string[],
        statusIds: (next.statusId ?? []) as number[],
        priorities: (next.priority ?? []) as string[],
        labelIds: (next.label ?? []) as number[],
        cycleIds: (next.cycle ?? []) as number[],
        ...componentFilterFromFacet(next.component),
        fixVersionIds: fixVersion.ids,
        fixVersionNone: fixVersion.none,
        affectsVersionIds: affectsVersion.ids,
        affectsVersionNone: affectsVersion.none,
        typeIds: (next.type ?? []) as number[],
        // 담당자 필터 — 숫자 id 배열로 왕복(#363), 「미지정」은 includeUnassigned 로 나눈다(WP-1020).
        ...assigneeFilterFromFacet(next.assignee),
        // 완료일 기간 — 단일 값(토큰)으로 왕복. 비면 null.
        closedIn: next.closedIn?.[0] != null ? String(next.closedIn[0]) : null,
      },
      view,
      groupParam,
    );
  }

  // 활성 facet 수(q 제외) — 모바일 칩 줄 「필터 지우기」 노출 판정.
  // 담당자 「미지정」은 assignee facet 값('none')에 담기므로 담당자 facet 하나로 센다.
  const activeFilterCount = countActiveFacets(filterValue, filters.includeUnassigned);

  // 「완료 모두 보기」 토글 — 데스크톱 버튼과 모바일 뷰 시트가 공유.
  function toggleShowAllClosed() {
    writeFilters({ ...filters, showAllClosed: !filters.showAllClosed }, view, groupParam);
  }

  // facet 값만 비운다 — 모바일 칩 줄 「필터 지우기」(검색은 툴바 🔍 가 따로 보이므로 남긴다). 검색어·view·group·에픽 범위는 유지.
  function clearFacets() {
    writeFilters(clearFacetFilters(filters), view, groupParam);
  }

  return {
    filters,
    view,
    groupParam,
    groupBy,
    qDraft,
    setQDraft,
    facets,
    filterValue,
    onFilterChange,
    activeFilterCount,
    hasActiveFilters,
    setView,
    setGroupBy,
    visibleGroupOptions,
    reset,
    showClosedToggle,
    closedHidingOverridden,
    toggleShowAllClosed,
    clearFacets,
    quickChips,
    quickFilterStorageKey,
  };
}
