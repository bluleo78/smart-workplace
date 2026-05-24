// TEXT 타입 커스텀 필드 위젯 — 빈 문자열은 null 로 변환해 row 삭제 의미를 전달.

import { Input } from '@/components/ui/input';

import type { IssueFieldDef } from '../../types/customField';

export function FieldTextInput({
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
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      placeholder={def.name}
      maxLength={2000}
      data-testid={`field-input-${def.id}`}
    />
  );
}
