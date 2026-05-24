// MULTI_SELECT 타입 위젯 — 옵션 토글 칩. 빈 집합은 null 로 변환 (row 삭제).

import type { IssueFieldDef } from '../../types/customField';

export function FieldMultiSelect({
  def,
  value,
  onChange,
}: {
  def: IssueFieldDef;
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const set = new Set(value ?? []);
  function toggle(opt: string) {
    const next = new Set(set);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange(next.size === 0 ? null : Array.from(next));
  }
  return (
    <div
      className="flex flex-wrap gap-1"
      role="group"
      aria-label={def.name}
      data-testid={`field-input-${def.id}`}
    >
      {(def.options ?? []).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          aria-pressed={set.has(opt)}
          className={`px-2 py-0.5 rounded text-xs border ${
            set.has(opt) ? 'bg-primary text-primary-foreground' : 'bg-background'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
