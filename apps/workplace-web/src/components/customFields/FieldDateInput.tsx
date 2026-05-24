// DATE 타입 위젯 — ISO (YYYY-MM-DD) 문자열만 다룬다. 빈 입력은 null.

import { Input } from '@/components/ui/input';

import type { IssueFieldDef } from '../../types/customField';

export function FieldDateInput({
  def,
  value,
  onChange,
}: {
  def: IssueFieldDef;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <Input
      type="date"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      aria-label={def.name}
      data-testid={`field-input-${def.id}`}
    />
  );
}
