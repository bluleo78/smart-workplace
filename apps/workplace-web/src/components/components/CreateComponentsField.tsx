// 이슈 만들기 창의 「구성요소」 칸(WP-933) — 고른 칩 + 「＋」 피커, 그리고 자동 지정 안내.
// 데스크톱 만들기 창에는 담당자 칸이 없어 구성요소를 고르면 늘 자동 지정 대상이다 → 「만들면 Compute 담당 박순 님이 맡아요」를 보인다.
// 노출 여부(구성원·사용 중 구성요소 있음)는 호출부(useIssueCreateForm.showComponents)가 정한다.

import { autoAssignHint } from '../../lib/issueComponents';
import type { ComponentResponse } from '../../types/component';
import { ComponentChip } from './ComponentChip';
import { ComponentPickerPopover } from './ComponentPickerPopover';

export function CreateComponentsField({
  components,
  value,
  onChange,
}: {
  /** 프로젝트 구성요소 전체(보관 포함, 목록 순서) — 피커가 보관된 것은 뺀다. */
  components: ComponentResponse[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const chosen = components.filter((c) => value.includes(c.id));
  const hint = autoAssignHint(value, components, false);
  return (
    <div className="space-y-1" data-testid="create-components-field">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">구성요소</span>
        <ComponentPickerPopover components={components} value={value} onCommit={onChange} />
      </div>
      <div className="flex flex-wrap gap-1" data-testid="create-components">
        {chosen.map((c) => (
          <ComponentChip key={c.id} component={c} />
        ))}
        {chosen.length === 0 && <span className="text-sm text-muted-foreground">없음</span>}
      </div>
      <ComponentAutoAssignHint hint={hint} />
    </div>
  );
}

/** 자동 지정 안내 한 줄 — 붙을 사람이 없으면(null) 그리지 않는다. 모바일 시트도 같은 문구를 쓴다. */
export function ComponentAutoAssignHint({ hint }: { hint: ReturnType<typeof autoAssignHint> }) {
  if (!hint) return null;
  return (
    <p className="text-sm text-muted-foreground" data-testid="create-component-assign-hint">
      만들면 {hint.componentName} 담당 {hint.assigneeName} 님이 맡아요
    </p>
  );
}
