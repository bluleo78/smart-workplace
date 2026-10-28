// 이슈 상세의 「구성요소」 행(WP-933) — 칩 목록 + 「＋」 피커(값이 없으면 줄 전체 「＋ 추가」, WP-1079). 속성 레일 첫 묶음의 담당자 바로 아래(모바일 속성 시트에선 단독)에 놓인다.
// 사용 중 구성요소가 없는 프로젝트에선 그리지 않고, 보관된 구성요소만 붙은 이슈는 값만 읽기 전용으로 보인다(showComponentField).

import { useComponents, useUpdateIssueComponents } from '../../hooks/queries/useComponents';
import { showComponentField } from '../../lib/issueComponents';
import type { ComponentSummary } from '../../types/component';
import { PropertyChipRow } from '../issue/PropertyChipRow';
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
  /** 워크플로 편집 권한 없음 — 고르기를 숨긴다(값은 보인다). */
  disabled?: boolean;
}) {
  const components = useComponents(projectKey);
  const update = useUpdateIssueComponents(projectKey, issueNumber);
  // 목록을 받기 전엔 판정하지 않는다 — 구성요소를 안 쓰는 프로젝트에서 칸이 잠깐 떴다 사라지지 않게.
  if (!components.isSuccess) return null;
  const mode = showComponentField(components.data, current);
  if (mode === 'hidden') return null;
  return (
    <PropertyChipRow
      label="구성요소"
      testId="issue-components-field"
      valuesTestId="issue-components"
      empty={current.length === 0}
      // 권한이 없거나 보관된 값만 붙었으면 고르기 없이 값만.
      picker={
        mode === 'edit' && !disabled
          ? (trigger) => (
              <ComponentPickerPopover
                components={components.data}
                value={current.map((c) => c.id)}
                onCommit={(ids) => update.mutate(ids)}
                trigger={trigger}
              />
            )
          : undefined
      }
    >
      {current.map((c) => (
        <ComponentChip key={c.id} component={c} />
      ))}
    </PropertyChipRow>
  );
}
