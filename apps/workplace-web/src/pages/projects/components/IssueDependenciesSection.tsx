// 이슈 의존성 섹션 (Phase 4b).
// 두 슬롯 노출: 차단됨(blockedBy, 선행 필요) / 차단 중(blocks).
// 각 슬롯은 IssueLinkPicker(추가) + IssueLinkRow 목록(제거).

import { IssueLinkRow } from '../../../components/issues/IssueLinkRow';
import { useRemoveIssueDependency } from '../../../hooks/queries/useIssueDependencies';
import type { IssueLinkSummary } from '../../../types/issue';
import { IssueLinkPicker } from './IssueLinkPicker';

export function IssueDependenciesSection({
  projectKey,
  issueNumber,
  blockedBy,
  blocks,
}: {
  projectKey: string;
  issueNumber: number;
  blockedBy: IssueLinkSummary[];
  blocks: IssueLinkSummary[];
}) {
  const remove = useRemoveIssueDependency(projectKey, issueNumber);

  return (
    <section
      aria-label="의존성"
      data-testid="issue-dependencies-section"
      className="space-y-3"
    >
      <h3 className="text-sm font-medium">의존성</h3>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">차단됨 (선행 필요)</span>
          <IssueLinkPicker
            projectKey={projectKey}
            issueNumber={issueNumber}
            direction="blockedBy"
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
                onRemove={() =>
                  remove.mutate({ otherNumber: l.number, direction: 'blockedBy' })
                }
              />
            ))
          )}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">차단 중</span>
          <IssueLinkPicker
            projectKey={projectKey}
            issueNumber={issueNumber}
            direction="blocks"
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
                onRemove={() =>
                  remove.mutate({ otherNumber: l.number, direction: 'blocks' })
                }
              />
            ))
          )}
        </ul>
      </div>
    </section>
  );
}
