// 이슈 목록 선택 열의 정의 한 곳(WP-270) — 헤더 문구·폭·셀 렌더러를 모아 평면 목록 thead(IssueListView)·
// 사이클 구간 열 이름 행(CycleSectionColumnHead)·행(IssueRow)·그룹 헤더 colSpan 이 모두 이것을 쓴다.
// 예전엔 헤더가 두 곳에 하드코딩돼 열을 바꾸려면 세 파일을 함께 고쳐야 했고, 폭이 어긋나면 사이클 구간 정렬이 깨졌다.
// 체크박스·상태·ID·제목·⋯ 는 항상 보이는 고정 열이라 여기서 다루지 않는다(키 모델은 lib/issueListColumns).

import { type ReactNode, useMemo } from 'react';

import { ComponentChips } from '../../../components/components/ComponentChip';
import { IssuePriorityBars } from '../../../components/issues/IssuePriorityBars';
import { AssigneeAvatar, UserAvatar } from '../../../components/users/UserAvatar';
import { VersionChips } from '../../../components/versions/VersionChip';
import { useCustomFields } from '../../../hooks/queries/useCustomFields';
import { formatDateOnlyMonthDay, formatDateTimeMinute, formatInstantMonthDay, formatListDueDate } from '../../../lib/formatters';
import { type ClosedInfo, closedInfo, closedVerb } from '../../../lib/issueClosedInfo';
import {
  type BuiltinColumnKey,
  DEFAULT_COLUMNS,
  isCustomColumnKey,
  type IssueListColumnKey,
} from '../../../lib/issueListColumns';
import { isOverdue } from '../../../lib/issueOverdue';
import { cn } from '../../../lib/utils';
import type { IssueFieldDef, IssueFieldEntry } from '../../../types/customField';
import type { IssueResponse } from '../../../types/issue';
import { IssueClosedDate } from './IssueClosedDate';

/** 열 폭(rem) — 쓰는 폭만 둔다. 새 폭을 쓰려면 아래 WIDTH_CLASS 에도 더해야 컴파일된다. */
export type ColumnWidthRem = 2.25 | 5 | 7 | 8;

/**
 * 폭(rem) → 헤더 칸 클래스 — `w-*`(table-fixed 사이클 구간) + `min-w-*`(자동 레이아웃 평면 목록 하한).
 * 폭의 원천은 rem 하나이고 클래스는 여기서만 얻는다. Tailwind 는 소스의 글자 그대로를 읽으므로 계산하지 않고 정적 문자열로 둔다.
 */
export const WIDTH_CLASS: Record<ColumnWidthRem, string> = {
  2.25: 'w-9 min-w-9',
  5: 'w-20 min-w-20',
  7: 'w-28 min-w-28',
  8: 'w-32 min-w-32',
};

/**
 * 폭(rem) → 셀(td) 폭 상한 — 글자를 말줄임하는 열(텍스트·날짜, 7·8rem)만. 평면 목록 표는 자동 레이아웃이라 헤더의 w-* 는 하한일 뿐,
 * 상한이 없으면 긴 값(텍스트 커스텀 필드·마일스톤·지난해 완료일)의 한 줄 폭만큼 칸이 넓어져 뒤 열이 화면 밖으로 밀린다(WP-1091).
 * 아이콘·아바타 열(2.25·5rem)은 내용 폭이 정해져 있고, 담당자 「+N」 은 칸 폭을 조금 넘을 수 있어 상한을 걸지 않는다(걸면 다음 칸을 덮는다).
 */
export const CELL_MAX_WIDTH_CLASS: Partial<Record<ColumnWidthRem, string>> = {
  7: 'max-w-28',
  8: 'max-w-32',
};

/** 선택 열 하나의 정의. */
export interface IssueListColumnDef {
  key: IssueListColumnKey;
  /** 헤더 문구 — 커스텀 필드는 필드 이름. */
  header: string;
  /** 아이콘 열(우선순위)처럼 헤더 문구를 스크린리더에만 둔다. */
  srOnlyHeader?: boolean;
  /** 'left' = ID 왼쪽(우선순위만), 'right' = 제목 뒤. */
  side: 'left' | 'right';
  /**
   * 헤더 칸 폭(rem) — 칸 클래스는 WIDTH_CLASS 에서 얻는다. 사이클 구간 표(table-fixed)는 열이 늘면 칸 합이 화면보다 넓어져도
   * 표가 넓어지지 않고 제목만 0 으로 줄어든다. 그래서 목록 전체 최소 폭을 열 폭 합으로 잡아 가로 스크롤시킨다(issueListMinWidthRem).
   */
  widthRem: ColumnWidthRem;
  /** 행 셀 내용. */
  cell: (issue: IssueResponse, ctx: { projectKey: string }) => ReactNode;
  /** 셀(td) 클래스 — 마감 지남 빨강처럼 값에 따라 바뀌는 톤. */
  cellClass?: (issue: IssueResponse) => string | undefined;
  /** 셀 툴팁 — 날짜 열의 정확한 값 등. */
  cellTitle?: (issue: IssueResponse) => string | undefined;
  /**
   * 셀(td) testid — `issue-row-{n}-{key}`. 완료일 열은 셀 안의 IssueClosedDate 가 같은 id(`issue-row-{n}-closed`, 모바일 메타와 같은 이름)를
   * 이미 달아 td 에 또 달면 중복이 되므로 비운다.
   */
  testId?: (n: number) => string;
}

/**
 * 항상 보이는 고정 열과 폭(rem) — 가로 스크롤 하한(issueListMinWidthRem)·그룹 헤더 colSpan(issueListColumnCount)의 기준.
 * ID 는 sm 이상 폭(w-28), 제목은 기본 밖의 열이 켜졌을 때의 최소 폭(min-w-64)이다.
 * 헤더 칸 클래스는 화면마다 달라(평면 목록은 min-w-* 를 함께, 사이클 구간은 w-* 만, ID 는 반응형) 각 화면이 직접 쓴다.
 */
const FIXED_COLUMNS = [
  { key: 'select', widthRem: 2.25 },
  { key: 'status', widthRem: 2.25 },
  { key: 'id', widthRem: 7 },
  { key: 'title', widthRem: 16 },
  { key: 'menu', widthRem: 2 },
] as const;

/** 고정 열 폭 합(rem). */
const FIXED_COLUMNS_REM = FIXED_COLUMNS.reduce((sum, c) => sum + c.widthRem, 0);

// 셀 조각은 컴포넌트가 아니라 JSX 를 돌려주는 함수로 둔다 — 이 모듈은 함수(buildColumnDefs 등)를 내보내므로
// 컴포넌트를 함께 두면 Fast Refresh 경계 규칙(react-refresh/only-export-components)에 걸린다.

/** 값 없음 표기 — 모든 선택 열이 같은 「—」를 쓴다. testId 는 셀 안에서 값 자리를 가리킬 때(완료일 열). */
function dash(testId?: string): ReactNode {
  return <span className="text-muted-foreground" data-testid={testId}>—</span>;
}

/** 이름 목록을 「첫 값 + `+N`」으로 — 사이클·다중 선택 커스텀 필드 공용. 셀 폭을 넘으면 첫 값만 말줄임한다. */
function firstPlus(items: string[]): ReactNode {
  if (items.length === 0) return dash();
  return (
    <span className="flex min-w-0 items-center">
      <span className="min-w-0 truncate">{items[0]}</span>
      {items.length > 1 && <span className="shrink-0 text-xs text-muted-foreground">&nbsp;+{items.length - 1}</span>}
    </span>
  );
}

/** 커스텀 필드 값 → 목록 칸 표시 문자열(다중 선택은 배열). 상세 편집기(CustomFieldEditor)가 다루는 값 모양과 같다. */
function customFieldText(def: IssueFieldDef, entry: IssueFieldEntry | undefined): string | string[] | null {
  const v = entry?.value;
  if (v == null || v === '') return null;
  switch (def.type) {
    case 'DATE':
      return formatDateOnlyMonthDay(String(v)) || null;
    case 'MULTI_SELECT':
      return Array.isArray(v) && v.length > 0 ? v.map(String) : null;
    default:
      // TEXT·NUMBER·SELECT — 값 그대로.
      return String(v);
  }
}

/** 커스텀 필드 툴팁 — 날짜는 원래 값(YYYY-MM-DD), 다중 선택은 전부, 나머지는 값 그대로(말줄임 대비). */
function customFieldTitle(entry: IssueFieldEntry | undefined): string | undefined {
  const v = entry?.value;
  if (v == null || v === '') return undefined;
  if (Array.isArray(v)) return v.map(String).join(', ');
  return String(v);
}

/**
 * 날짜 칸 공통 클래스 — 날짜가 글자 단위로 꺾이지 않고(nowrap), 다음 칸과 붙지 않게(pr-3).
 * overflow-hidden·text-ellipsis — 사이클 구간 표(table-fixed)는 칸 폭이 고정이라 지난해 날짜(「✓ 2025년 10월 23일 +2일」)가
 * 다음 칸으로 번진다. 말줄임하고 정확한 값은 셀 툴팁(title)으로 본다.
 */
const DATE_CELL = 'overflow-hidden text-ellipsis whitespace-nowrap pr-3 text-muted-foreground';
/** 텍스트 칸 공통 — 칸 폭 안에서 말줄임(안쪽 span 이 truncate). 칸 폭 상한은 columnCellClass 가 건다. */
const TEXT_CELL = 'pr-3';

/** 셀 testid — `issue-row-{n}-{key}`. */
const cellTestId = (key: IssueListColumnKey) => (n: number) => `issue-row-${n}-${key}`;

/**
 * 날짜 열(시작일·생성일·수정일) — 셀은 짧은 표기(없으면 「—」), 툴팁은 정확한 값. 모양(DATE_CELL·testid)은 셋이 같다.
 * 표기·툴팁 포맷만 열마다 달라(날짜 전용 vs 시각) 함수로 받는다.
 */
function dateCol(
  key: 'start' | 'created' | 'updated',
  header: string,
  widthRem: ColumnWidthRem,
  { text, title }: { text: (it: IssueResponse) => string; title: (it: IssueResponse) => string | undefined },
): IssueListColumnDef {
  return {
    key, header, side: 'right', widthRem, testId: cellTestId(key),
    cellClass: () => DATE_CELL,
    cellTitle: title,
    cell: (it) => text(it) || '—',
  };
}

// 완료일 셀은 내용(cell)과 툴팁(cellTitle)이 같은 판정을 쓴다 — 행마다 두 번 계산하지 않게 이슈 객체별로 기억한다.
// 이슈 응답은 바뀌면 새 객체라(쿼리 캐시·낙관적 갱신) 객체 키로 충분하고, WeakMap 이라 지난 객체와 함께 사라진다. null 도 기억한다.
const closedInfoCache = new WeakMap<IssueResponse, ClosedInfo | null>();
function closedInfoOf(it: IssueResponse): ClosedInfo | null {
  if (!closedInfoCache.has(it)) closedInfoCache.set(it, closedInfo(it));
  return closedInfoCache.get(it) ?? null;
}

/** 내장 열 정의 — 표시 순서는 lib/issueListColumns 의 BUILTIN_ORDER 가 정한다(여기 순서는 무관). */
function builtinDef(key: BuiltinColumnKey): IssueListColumnDef {
  const tid = cellTestId(key);
  switch (key) {
    case 'priority':
      return {
        key, header: '우선순위', srOnlyHeader: true, side: 'left', widthRem: 2.25, testId: tid,
        cell: (it) => <IssuePriorityBars priority={it.priority} />,
      };
    case 'assignee':
      return {
        key, header: '담당자', side: 'right', widthRem: 5, testId: tid,
        // 제목 칸이 w-full 로 남은 폭을 가져가므로 whitespace-nowrap·pr-3 으로 「+N」 이 다음 칸에 붙지 않게 한다(WP-194).
        cellClass: () => 'whitespace-nowrap pr-3',
        cell: (it) => (
          <span className="flex items-center -space-x-1">
            {it.assignees.length === 0 ? (
              dash()
            ) : (
              <>
                {it.assignees.slice(0, 3).map((u) => (
                  // AGENT(AI) 담당자는 보라색 ring + Bot 마커로 사람과 시각 구분.
                  <AssigneeAvatar key={u.id} user={u} size="xs" ring />
                ))}
                {it.assignees.length > 3 && (
                  <span className="ml-1 text-xs text-muted-foreground">+{it.assignees.length - 3}</span>
                )}
              </>
            )}
          </span>
        ),
      };
    case 'due':
      return {
        key, header: '마감', side: 'right', widthRem: 8, testId: tid,
        // 마감 지난 미완료 이슈는 홈 「내 작업」처럼 빨간 굵은 글씨로 구분한다(WP-649).
        cellClass: (it) => cn('overflow-hidden text-ellipsis whitespace-nowrap pr-2', isOverdue(it) ? 'font-semibold text-destructive' : 'text-muted-foreground'),
        cellTitle: (it) => it.dueDate ?? undefined,
        // 날짜 글자를 td 의 첫 자식 텍스트로 둔다 — 줄바꿈 회귀 테스트가 첫 텍스트 노드를 잰다(issue-list-epic-group.spec).
        // 마감 표기는 목록 공용 규칙(formatListDueDate, WP-919 — 올해 「10월 25일」, 다른 해 「2027. 1. 5」, 없음 「—」).
        cell: (it) => (
          <>
            {formatListDueDate(it.dueDate)}
            {isOverdue(it) && <span className="sr-only"> 마감 지남</span>}
          </>
        ),
      };
    case 'closed':
      return {
        key, header: '완료일', side: 'right', widthRem: 8,
        cellClass: () => DATE_CELL,
        // 툴팁 = 정확한 시각 + 완료/취소 + 늦음 — 사이클 구간 표에선 말줄임이 「+N일」 을 가릴 수 있어 여기에도 싣는다.
        cellTitle: (it) => {
          const info = closedInfoOf(it);
          if (!info) return undefined;
          return `${formatDateTimeMinute(info.closedAt)} ${closedVerb(info.kind)}${info.lateDays !== null ? ` · 마감 +${info.lateDays}일` : ''}`;
        },
        cell: (it) => {
          const info = closedInfoOf(it);
          // 진행 중·재오픈·구버전 응답(closedAt 없음) — 완료일이 없다.
          if (!info) return dash(`issue-row-${it.number}-closed`);
          return <IssueClosedDate info={info} testIdPrefix={`issue-row-${it.number}`} />;
        },
      };
    case 'start':
      return dateCol(key, '시작일', 7, {
        text: (it) => formatDateOnlyMonthDay(it.startDate),
        title: (it) => it.startDate ?? undefined,
      });
    case 'created':
      return dateCol(key, '생성일', 7, {
        text: (it) => formatInstantMonthDay(it.createdAt),
        title: (it) => formatDateTimeMinute(it.createdAt),
      });
    case 'updated':
      return dateCol(key, '수정일', 7, {
        text: (it) => formatInstantMonthDay(it.updatedAt),
        title: (it) => formatDateTimeMinute(it.updatedAt),
      });
    case 'reporter':
      return {
        key, header: '보고자', side: 'right', widthRem: 8, testId: tid,
        cellClass: () => TEXT_CELL,
        cellTitle: (it) => it.reporter?.name ?? undefined,
        // 롤링 배포 중 구버전 응답·모르는 사용자면 reporter 가 없다 → 「—」.
        cell: (it) =>
          it.reporter ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <UserAvatar user={it.reporter} size="xs" agent={it.reporter.kind === 'AGENT'} />
              <span className="min-w-0 truncate">{it.reporter.name}</span>
            </span>
          ) : (
            dash()
          ),
      };
    case 'milestone':
      return {
        key, header: '마일스톤', side: 'right', widthRem: 8, testId: tid,
        cellClass: () => TEXT_CELL,
        cellTitle: (it) => it.milestoneName ?? undefined,
        cell: (it) => (it.milestoneName ? <span className="block truncate">{it.milestoneName}</span> : dash()),
      };
    case 'cycle':
      return {
        key, header: '사이클', side: 'right', widthRem: 8, testId: tid,
        cellClass: () => TEXT_CELL,
        // 여럿이면 첫 하나 + `+N`, 툴팁에 전부(스펙 5).
        cellTitle: (it) => (it.cycles?.length ? it.cycles.map((c) => c.name).join(', ') : undefined),
        cell: (it) => firstPlus((it.cycles ?? []).map((c) => c.name)),
      };
    case 'components':
      return {
        key, header: '구성요소', side: 'right', widthRem: 8, testId: tid,
        cellClass: () => TEXT_CELL,
        // 칩 2개 + 「+N」(스펙 6절), 툴팁에 전부. 구버전 응답(components 없음)·없음은 「—」.
        cellTitle: (it) => (it.components?.length ? it.components.map((c) => c.name).join(', ') : undefined),
        cell: (it) =>
          it.components?.length ? <ComponentChips components={it.components} className="max-w-full overflow-hidden" /> : dash(),
      };
    // 수정 버전·영향 버전(WP-888) — 구성요소 열과 같은 모양(칩 2개 + 「+N」, 툴팁에 전부).
    case 'fixVersions':
      return {
        key, header: '수정 버전', side: 'right', widthRem: 8, testId: tid,
        cellClass: () => TEXT_CELL,
        cellTitle: (it) => (it.fixVersions?.length ? it.fixVersions.map((v) => v.name).join(', ') : undefined),
        cell: (it) =>
          it.fixVersions?.length ? <VersionChips versions={it.fixVersions} className="max-w-full overflow-hidden" /> : dash(),
      };
    case 'affectsVersions':
      return {
        key, header: '영향 버전', side: 'right', widthRem: 8, testId: tid,
        cellClass: () => TEXT_CELL,
        cellTitle: (it) => (it.affectsVersions?.length ? it.affectsVersions.map((v) => v.name).join(', ') : undefined),
        cell: (it) =>
          it.affectsVersions?.length ? <VersionChips versions={it.affectsVersions} className="max-w-full overflow-hidden" /> : dash(),
      };
  }
}

/** 커스텀 필드 열 정의 — 헤더는 필드 이름, 값 표기는 유형별(다중 선택은 첫 값 + `+N`). */
function customDef(key: `cf${number}`, def: IssueFieldDef): IssueListColumnDef {
  const entryOf = (it: IssueResponse) => it.customFields.find((e) => e.defId === def.id);
  return {
    key, header: def.name, side: 'right', widthRem: 8,
    testId: cellTestId(key),
    cellClass: () => TEXT_CELL,
    cellTitle: (it) => customFieldTitle(entryOf(it)),
    cell: (it) => {
      const text = customFieldText(def, entryOf(it));
      if (text == null) return dash();
      if (Array.isArray(text)) return firstPlus(text);
      return <span className="block truncate">{text}</span>;
    },
  };
}

/**
 * 열 키(이미 표시 순서로 정렬된 것, resolveColumns 결과) → 열 정의.
 * 정의 목록에 없는 커스텀 필드 키(정의 로딩 중·삭제됨)는 건너뛴다 — 이름 없는 빈 열을 그리지 않게.
 */
export function buildColumnDefs(keys: IssueListColumnKey[], fieldDefs: IssueFieldDef[]): IssueListColumnDef[] {
  const byId = new Map(fieldDefs.map((d) => [d.id, d]));
  const out: IssueListColumnDef[] = [];
  for (const key of keys) {
    if (isCustomColumnKey(key)) {
      const def = byId.get(Number(key.slice(2)));
      if (def) out.push(customDef(key, def));
    } else {
      out.push(builtinDef(key));
    }
  }
  return out;
}

/** 선택 열 정의 — 전체(표시 순서)와 ID 왼쪽 / 제목 뒤로 한 번 나눈 것. 행·헤더가 행마다 다시 거르지 않게 목록이 한 번 만든다. */
export interface ColumnDefs {
  defs: IssueListColumnDef[];
  left: IssueListColumnDef[];
  right: IssueListColumnDef[];
}

/**
 * 열 키 → 열 정의(평면 목록·사이클 구간 목록·뷰 저장 창 공용). 커스텀 필드 열이 있을 때만 필드 정의를 불러온다
 * (기본 열 화면은 요청이 늘지 않게). 결과는 메모해 둔다 — memo 행(IssueRow)이 매번 다시 그려지지 않게.
 */
export function useColumnDefs(projectKey: string, columns: IssueListColumnKey[]): ColumnDefs {
  const fields = useCustomFields(projectKey, { enabled: columns.some(isCustomColumnKey) });
  return useMemo(() => {
    const defs = buildColumnDefs(columns, fields.data ?? []);
    return { defs, left: defs.filter((d) => d.side === 'left'), right: defs.filter((d) => d.side === 'right') };
  }, [columns, fields.data]);
}

/**
 * 한쪽(ID 왼쪽 / 제목 뒤, ColumnDefs 의 left·right) 선택 열의 헤더 칸들 — 평면 목록 thead 와 사이클 구간 열 이름 행이 같은 문구·폭을 쓰게 한다.
 * thClass 는 화면별 칸 모양(여백·글자), hideLabel 은 사이클 구간 표의 0 높이 폭 정의 행처럼 문구를 스크린리더에만 둘 때.
 * 컴포넌트가 아니라 <th> 배열을 돌려주는 함수 — <tr> 의 직계 자식이어야 해서 감싸는 요소를 둘 수 없다.
 */
export function columnHeadCells(
  defs: IssueListColumnDef[],
  { thClass, hideLabel = false }: { thClass?: string; hideLabel?: boolean } = {},
): ReactNode[] {
  return defs.map((d) => (
    <th key={d.key} className={cn(WIDTH_CLASS[d.widthRem], thClass)}>
      <span className={cn((d.srOnlyHeader || hideLabel) && 'sr-only')}>{d.header}</span>
    </th>
  ));
}

/** 셀(td) 클래스 — 열 폭에서 얻는 폭 상한 + 값에 따른 톤(cellClass). 평면 목록·사이클 구간 행이 모두 이것으로 칸을 그린다. */
export function columnCellClass(def: IssueListColumnDef, issue: IssueResponse): string {
  return cn(CELL_MAX_WIDTH_CLASS[def.widthRem], def.cellClass?.(issue));
}

/** 표의 전체 열 수 — 고정 열(체크·상태·ID·제목·⋯) + 선택 열. 그룹 헤더 colSpan 에 쓴다. */
export function issueListColumnCount(defs: IssueListColumnDef[]): number {
  return FIXED_COLUMNS.length + defs.length;
}

/**
 * 기본 열(우선순위·담당자·마감) 밖의 열이 켜졌는지 — 제목 최소 폭(16rem)·가로 스크롤 하한은 이때만 건다.
 * 기본 구성에 걸면 1024px 화면(사이드바·에픽 패널)에서 지금은 없는 가로 스크롤이 생겨 「기본 화면 불변」이 깨진다.
 */
export function hasExtraColumns(defs: IssueListColumnDef[]): boolean {
  return defs.some((d) => !DEFAULT_COLUMNS.includes(d.key));
}

/**
 * 표 최소 폭(rem) — 고정 열(제목 16rem 포함) + 선택 열 폭 합. 사이클 구간 목록(table-fixed)의 가로 스크롤 하한.
 * 기본 열 밖의 열이 없으면 null — 지금처럼 제목이 남은 폭에 맞춰 줄어든다(hasExtraColumns).
 */
export function issueListMinWidthRem(defs: IssueListColumnDef[]): number | null {
  if (!hasExtraColumns(defs)) return null;
  return defs.reduce((sum, d) => sum + d.widthRem, FIXED_COLUMNS_REM);
}
