// SELECT 타입 위젯 — 옵션 외 값은 백엔드가 400. 첫 옵션은 "선택 안 함" (null).

import type { IssueFieldDef } from '../../types/customField';

export function FieldSelect({
  def,
  value,
  onChange,
}: {
  def: IssueFieldDef;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <select
      className="border rounded p-2 bg-background w-full"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      aria-label={def.name}
      data-testid={`field-input-${def.id}`}
    >
      <option value="">선택 안 함</option>
      {(def.options ?? []).map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
