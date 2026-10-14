// 메모리 내용 입력 공용 조각(WP-55) — 여러 줄 입력 + n / 300 카운트 + 취소/제출. 직접 추가 폼과 행의 제자리 고치기가 같이 쓴다.
// 빈 내용·300자 초과면 제출 비활성(초과 시 카운트 빨강, 자르지 않음). 터치 기기는 버튼을 44px 로 키운다(스펙 §7).
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { canSubmitContent, contentCountTone, MEMORY_MAX_CHARS, memoryLength } from '@/lib/aiMemory';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  /** 제출 버튼 문구(추가·저장). */
  submitLabel: string;
  /** 저장 요청이 진행 중이면 제출을 막는다. */
  pending: boolean;
  rows: number;
  placeholder?: string;
  /** 입력란 접근성 이름 — 추가 폼과 행 고치기가 함께 열려도 구분되게 화면마다 다르게 준다. */
  ariaLabel: string;
  /** 화면별 테스트 식별자 접두 — `{접두}-input`·`-count`·`-submit`. */
  testIdPrefix: string;
  /** 입력란 아래·버튼 줄 위에 놓을 추가 입력(범위·기한 — WP-379·380). */
  fields?: ReactNode;
}

export function AiMemoryContentEditor({ value, onChange, onCancel, onSubmit, submitLabel, pending, rows, placeholder, ariaLabel, testIdPrefix, fields }: Props) {
  const len = memoryLength(value);
  return (
    <>
      <Textarea
        data-testid={`${testIdPrefix}-input`}
        aria-label={ariaLabel}
        rows={rows}
        autoFocus
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {fields && <div className="flex flex-wrap items-center gap-2">{fields}</div>}
      <div className="flex items-center gap-2">
        <span data-testid={`${testIdPrefix}-count`} className={cn('text-xs tabular-nums', contentCountTone(len))}>
          {len} / {MEMORY_MAX_CHARS}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto pointer-coarse:min-h-11" onClick={onCancel}>
          취소
        </Button>
        <Button size="sm" className="pointer-coarse:min-h-11" data-testid={`${testIdPrefix}-submit`} disabled={!canSubmitContent(value) || pending} onClick={onSubmit}>
          {submitLabel}
        </Button>
      </div>
    </>
  );
}
