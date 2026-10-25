// 이슈 상세의 「구성요소」 행(WP-933) — 칩 목록 + 「＋」 피커. 속성 레일 첫 묶음의 담당자 바로 아래(모바일 속성 시트에선 단독)에 놓인다.
// 사용 중 구성요소가 없는 프로젝트에선 그리지 않고, 보관된 구성요소만 붙은 이슈는 값만 읽기 전용으로 보인다(showComponentField).

import { useComponents, useUpdateIssueComponents } from '../../hooks/queries/useComponents';
import { showComponentField } from '../../lib/issueComponents';
import type { ComponentSummary } from '../../types/component';
import { ComponentChip } from './ComponentChip';
import { ComponentPickerPopover } from './ComponentPickerPopover';

export function IssueComponentsField({
  projectKey,
  issueNumber,
  current,
  disabled = false,
}: {
  projectKey: string;
  issueNumber: number;
  /** 이슈에 붙은 구성요소(목록 순서). */
  current: ComponentSummary[];
  /** 워크플로 편집 권한 없음 — 피커만 막는다(값은 보인다). */
  disabled?: boolean;
}) {
  const components = useComponents(projectKey);
  const update = useUpdateIssueComponents(projectKey, issueNumber);
  // 목록을 받기 전엔 판정하지 않는다 — 구성요소를 안 쓰는 프로젝트에서 칸이 잠깐 떴다 사라지지 않게.
  if (!components.isSuccess) return null;
  const mode = showComponentField(components.data, current);
  if (mode === 'hidden') return null;
  return (
    <div className="space-y-1" data-testid="issue-components-field">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">구성요소</span>
        {mode === 'edit' && (
          <ComponentPickerPopover
            components={components.data}
            value={current.map((c) => c.id)}
            onCommit={(ids) => update.mutate(ids)}
            disabled={disabled || update.isPending}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-1" data-testid="issue-components">
        {current.map((c) => (
          <ComponentChip key={c.id} component={c} />
        ))}
        {current.length === 0 && <span className="text-xs text-muted-foreground">없음</span>}
      </div>
    </div>
  );
}
