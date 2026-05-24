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
}: {
  def: IssueFieldDef;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  switch (def.type) {
    case 'TEXT':
      return <FieldTextInput def={def} value={(value as string | null) ?? null} onChange={onChange} />;
    case 'NUMBER':
      return <FieldNumberInput def={def} value={(value as number | null) ?? null} onChange={onChange} />;
    case 'DATE':
      return <FieldDateInput def={def} value={(value as string | null) ?? null} onChange={onChange} />;
    case 'SELECT':
      return <FieldSelect def={def} value={(value as string | null) ?? null} onChange={onChange} />;
    case 'MULTI_SELECT':
      return (
        <FieldMultiSelect
          def={def}
          value={(value as string[] | null) ?? null}
          onChange={onChange}
        />
      );
    default:
      return null;
  }
}
