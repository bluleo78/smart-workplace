// 커스텀 필드 위젯 dispatcher — type 별 정적 매핑. onChange(value|null) 로 위로 전달.

import type { IssueFieldDef } from '../../types/customField';
import { FieldDateInput } from './FieldDateInput';
import { FieldMultiSelect } from './FieldMultiSelect';
import { FieldNumberInput } from './FieldNumberInput';
import { FieldSelect } from './FieldSelect';
import { FieldTextInput } from './FieldTextInput';

export function CustomFieldEditor({
  def,
  value,
  onChange,
  disabled = false,
}: {
  def: IssueFieldDef;
  value: unknown;
  onChange: (next: unknown) => void;
  /** 편집 권한 없음 — 값은 보이되 바꿀 수 없다(서버는 멤버만 저장 허용). */
  disabled?: boolean;
}) {
  // 위젯 공통 props — 유형별로 다른 건 value 의 모양뿐이다.
  const common = { def, onChange, disabled };
  switch (def.type) {
    case 'TEXT':
      return <FieldTextInput {...common} value={(value as string | null) ?? null} />;
    case 'NUMBER':
      return <FieldNumberInput {...common} value={(value as number | null) ?? null} />;
    case 'DATE':
      return <FieldDateInput {...common} value={(value as string | null) ?? null} />;
    case 'SELECT':
      return <FieldSelect {...common} value={(value as string | null) ?? null} />;
    case 'MULTI_SELECT':
      return <FieldMultiSelect {...common} value={(value as string[] | null) ?? null} />;
    default:
      return null;
  }
}
