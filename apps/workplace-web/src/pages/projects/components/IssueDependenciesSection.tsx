// 이슈 의존성 섹션 (Phase 4b).
// 두 슬롯 노출: 차단됨(blockedBy, 선행 필요) / 차단 중(blocks).
// 각 슬롯은 IssueLinkPicker(추가) + IssueLinkRow 목록(제거).

import type { DependencyDirection } from '../../../api/issueDependencies';
import { IssueLinkRow } from '../../../components/issues/IssueLinkRow';
import { useRemoveIssueDependency } from '../../../hooks/queries/useIssueDependencies';
import type { IssueLinkSummary } from '../../../types/issue';
import { IssueLinkPicker } from './IssueLinkPicker';

export function IssueDependenciesSection({
  projectKey,
  issueNumber,
  blockedBy,
  blocks,
  disabled = false,
}: {
  projectKey: string;
  issueNumber: number;
  blockedBy: IssueLinkSummary[];
  blocks: IssueLinkSummary[];
  /** 워크플로 편집 권한 없음(OPEN 비멤버) — 추가 버튼을 막고 제거 조작은 그리지 않는다(WP-503, 서버는 멤버만 허용). */
  disabled?: boolean;
}) {
  const remove = useRemoveIssueDependency(projectKey, issueNumber);
  // 행 제거 핸들러 — 편집할 수 없으면 undefined 를 넘겨 행이 제거 조작을 그리지 않게 한다.
  const removeFor = (otherNumber: number, direction: DependencyDirection) =>
    disabled ? undefined : () => remove.mutate({ otherNumber, direction });

  return (
    <section
      aria-label="의존성"
      data-testid="issue-dependencies-section"
      className="space-y-3"
    >
      {/* 그룹 카드 제목(의존성)이 이미 있으므로 내부 헤딩 제거(중복). */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground">차단됨 (선행 필요)</span>
          <IssueLinkPicker
            projectKey={projectKey}
            issueNumber={issueNumber}
            direction="blockedBy"
            disabled={disabled}
          />
        </div>
        <ul data-testid="blocked-by-list">
          {blockedBy.length === 0 ? (
            <li className="text-xs text-muted-foreground">없음</li>
          ) : (
            blockedBy.map((l) => (
              <IssueLinkRow
                key={`bb-${l.number}`}
                projectKey={projectKey}
                link={l}
                onRemove={removeFor(l.number, 'blockedBy')}
              />
            ))
          )}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground">차단 중</span>
          <IssueLinkPicker
            projectKey={projectKey}
            issueNumber={issueNumber}
            direction="blocks"
            disabled={disabled}
          />
        </div>
        <ul data-testid="blocks-list">
          {blocks.length === 0 ? (
            <li className="text-xs text-muted-foreground">없음</li>
          ) : (
            blocks.map((l) => (
              <IssueLinkRow
                key={`b-${l.number}`}
                projectKey={projectKey}
                link={l}
                onRemove={removeFor(l.number, 'blocks')}
              />
            ))
          )}
        </ul>
      </div>
    </section>
  );
}
