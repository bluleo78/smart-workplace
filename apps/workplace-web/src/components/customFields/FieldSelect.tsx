// SELECT 타입 위젯 — 옵션 외 값은 백엔드가 400. 첫 옵션은 "선택 안 함" (null).
// Radix Select는 빈 문자열 value를 허용하지 않아 '__none__' 센티넬로 null을 표현한다 (#270).

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
    <Select
      value={value ?? '__none__'}
      onValueChange={(v) => onChange(v === '__none__' ? null : v)}
    >
      <SelectTrigger
        className="w-full"
        aria-label={def.name}
        data-testid={`field-input-${def.id}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">선택 안 함</SelectItem>
        {(def.options ?? []).map((opt) => (
          <SelectItem key={opt} value={opt}>
            {opt}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
