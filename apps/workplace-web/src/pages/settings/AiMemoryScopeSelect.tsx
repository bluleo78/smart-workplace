// 메모리 범위 고르기(WP-379) — 직접 추가·제자리 고치기가 같이 쓴다. 가득 찬 범위는 "가득 참" 으로 비활성(지금 범위는 같은 범위 고치기라 예외).
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select';
import { type AiMemoryScopeKey, SCOPE_LABEL, SCOPE_ORDER } from '@/lib/aiMemory';

interface Props {
  value: AiMemoryScopeKey;
  onChange: (value: AiMemoryScopeKey) => void;
  /** 한도에 닿은 범위 — 고를 수 없다. */
  fullScopes: ReadonlySet<AiMemoryScopeKey>;
  /** 항목의 지금 범위 — 가득이어도 고를 수 있다(머무는 것은 한도와 무관). 추가 폼은 없음. */
  current?: AiMemoryScopeKey;
  /** 트리거 testid — 옵션은 `{testId}-{범위}`. */
  testId: string;
}

export function AiMemoryScopeSelect({ value, onChange, fullScopes, current, testId }: Props) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AiMemoryScopeKey)}>
      <SelectTrigger size="sm" aria-label="범위" data-testid={testId} className="pointer-coarse:min-h-11">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SCOPE_ORDER.map((k) => {
          const blocked = fullScopes.has(k) && k !== current;
          return (
            <SelectItem key={k} value={k} disabled={blocked} data-testid={`${testId}-${k}`}>
              {k === 'COMMON' ? '공통 (모든 AI)' : SCOPE_LABEL[k]}
              {blocked ? ' · 가득 참' : ''}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
