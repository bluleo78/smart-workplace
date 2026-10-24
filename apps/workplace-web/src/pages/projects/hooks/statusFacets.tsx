// 이슈 필터 바의 상태 facet 두 개(WP-808) — 이슈 목록·보드 필터 바와 타임라인 필터가 같은 정의를 쓴다.
// 「상태」는 프로젝트 상태(개별, URL statusId), 「상태 범주」는 범주 4개(URL status — 예전 링크·저장 뷰가 그대로 이 필터로 열린다).

import type { FacetDef } from '@/components/filter';
import type { PickerOption } from '@/components/mobile/MobilePickerSheet';

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { ISSUE_STATUS_LABEL, ISSUE_STATUSES } from '../../../lib/issueGrouping';
import type { IssueStatus } from '../../../types/issue';
import type { ProjectStatus } from '../../../types/projectStatus';

// 옵션 표시 — 목록 행·배지와 같은 상태 아이콘(모양=범주, 색=상태 색)을 이름 앞에 붙여 시각 일관성을 맞춘다.
// 범주 facet 은 color 없이 불러 범주 색을 쓴다.
function withIcon(category: IssueStatus, label: string, color?: string | null) {
  return (
    <span className="flex items-center gap-1.5">
      <IssueStatusIcon status={category} color={color} decorative />
      {label}
    </span>
  );
}

/**
 * 모바일 상태 선택 시트 선택지 — 값은 statusId 문자열, 앞에 범주 아이콘. 이슈 상세 상태 칩·행 액션 시트가 같은 모양을 쓴다.
 * 고른 값은 findStatus(lib/projectStatuses)로 상태로 되돌린다.
 */
export function statusPickerOptions(statuses: readonly ProjectStatus[]): PickerOption[] {
  return statuses.map((s) => ({ value: String(s.id), label: s.name, icon: <IssueStatusIcon status={s.category} color={s.color} decorative /> }));
}

/**
 * 「상태」·「상태 범주」 facet 을 만든다.
 * @param statuses 프로젝트 상태(서버 표시 순서) — 로딩 중이면 빈 배열이고, 그동안 「상태」 facet 은 고를 값이 없다.
 */
export function buildStatusFacets(statuses: readonly ProjectStatus[]): FacetDef[] {
  return [
    {
      key: 'statusId',
      label: '상태',
      options: statuses.map((s) => ({ value: s.id, label: s.name, render: withIcon(s.category, s.name, s.color) })),
    },
    {
      key: 'status',
      label: '상태 범주',
      options: ISSUE_STATUSES.map((c) => ({
        value: c,
        label: ISSUE_STATUS_LABEL[c],
        render: withIcon(c, ISSUE_STATUS_LABEL[c]),
      })),
    },
  ];
}
