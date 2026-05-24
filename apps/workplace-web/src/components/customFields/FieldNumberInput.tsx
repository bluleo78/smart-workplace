// NUMBER 타입 위젯 — 빈 입력은 null, 유한 숫자만 통과.

import { Input } from '@/components/ui/input';

import type { IssueFieldDef } from '../../types/customField';

export function FieldNumberInput({
  def,
  value,
  onChange,
}: {
  def: IssueFieldDef;
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <Input
      type="number"
      value={value ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') {
          onChange(null);
          return;
        }
        const n = Number(v);
        if (Number.isFinite(n)) onChange(n);
      }}
      placeholder={def.name}
      data-testid={`field-input-${def.id}`}
    />
  );
}
