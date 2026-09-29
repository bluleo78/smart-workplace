// NUMBER 타입 위젯 — 빈 입력은 null, 유한 숫자만 통과.
// 안전 정수 범위(Number.MAX_SAFE_INTEGER, 2^53-1)를 벗어나는 값은 JS Number(IEEE 754 double)
// 변환 과정에서 소리 없이 반올림되어 지수표기(예: 1e+23)로 저장/표시되는 데이터 손상이 발생하므로(#813),
// 범위를 벗어나면 반영을 거부하고 경고 토스트를 띄운다.

import { useState } from 'react';
import { toast } from 'sonner';

import { Input } from '@/components/ui/input';
import { formatNumber } from '@/lib/formatters';

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
  // 안전 정수 범위 초과로 입력을 거부했을 때, controlled input 이 실제로 재렌더되도록
  // 강제하기 위한 더미 상태 (React 는 controlled <input> 커밋 시 DOM value 를 항상
  // props.value 문자열로 재동기화하므로, re-render 만 유발하면 브라우저가 표시 중인
  // 지수표기 텍스트가 마지막 유효값으로 되돌아간다).
  const [, forceSync] = useState(0);

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
        if (!Number.isFinite(n)) return;
        if (Math.abs(n) > Number.MAX_SAFE_INTEGER) {
          toast.warning(
            `안전한 정수 범위(±${formatNumber(Number.MAX_SAFE_INTEGER)})를 벗어난 값은 정밀도 손실이 발생해 반영되지 않았습니다.`,
          );
          forceSync((k) => k + 1);
          return;
        }
        onChange(n);
      }}
      placeholder="숫자를 입력하세요"
      data-testid={`field-input-${def.id}`}
    />
  );
}
