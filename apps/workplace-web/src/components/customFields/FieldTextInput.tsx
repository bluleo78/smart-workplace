// TEXT 타입 커스텀 필드 위젯 — 빈 문자열은 null 로 변환해 row 삭제 의미를 전달.

import { Input } from '@/components/ui/input';

import type { IssueFieldDef } from '../../types/customField';

export function FieldTextInput({
  def,
  value,
  onChange,
  disabled = false,
}: {
  def: IssueFieldDef;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <Input
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      placeholder="값을 입력하세요"
      // 필드 이름으로 읽힌다 — 이름이 없으면 placeholder 로 떨어져 칸이 여럿일 때 구분되지 않았다(WP-854, 선택형 위젯과 같은 방식).
      aria-label={def.name}
      maxLength={2000}
      data-testid={`field-input-${def.id}`}
    />
  );
}
