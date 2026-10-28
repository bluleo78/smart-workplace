// 속성 레일의 칩 줄(구성요소·수정 버전·영향 버전) 공용 모양(WP-1079) — 제목 아래 값 자리에서 고른다.
// 예전엔 제목 줄 오른쪽 끝의 테두리 「＋」 상자가 제목 줄을 높이고, 값이 들여쓰기 없이 시작해 담당자·보고자와 선이 어긋났다.
import { Plus } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { INLINE_FIELD_CLASS, INLINE_FIELD_RAIL_CLASS } from './inlineField';

/** 피커 트리거 모양 — button: 테두리 「＋」 상자(만들기 창), row: 값이 없을 때 줄 전체 「＋ 추가」, icon: 칩 뒤 작은 「＋」. */
export type PickerTriggerVariant = 'button' | 'row' | 'icon';

/**
 * 피커 팝오버의 PopoverTrigger asChild 자식. row·icon 은 같은 <button> 요소로 그린다 — 첫 값을 붙여 row → icon 으로 바뀌어도
 * DOM 이 그대로라 팝오버를 닫을 때 돌아온 포커스를 잃지 않는다.
 */
export function PickerAddTrigger({
  variant,
  className,
  ...props
}: { variant: PickerTriggerVariant } & ComponentProps<'button'>) {
  if (variant === 'button')
    return (
      <Button type="button" variant="outline" size="sm" className={className} {...props}>
        <Plus className="h-4 w-4" />
      </Button>
    );
  return (
    <button
      type="button"
      className={cn(
        variant === 'icon'
          ? cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }), 'text-muted-foreground')
          : // 담당자 필드와 같은 인라인 필드 모양(같은 들여쓰기·마우스 올리면 테두리).
            cn(INLINE_FIELD_RAIL_CLASS, INLINE_FIELD_CLASS, 'gap-1.5 text-muted-foreground'),
        className,
      )}
      {...props}
    >
      <Plus className={variant === 'row' ? 'h-4 w-4' : undefined} aria-hidden />
      {variant === 'row' && '추가'}
    </button>
  );
}

/**
 * 제목 + 칩 줄. 붙일 수 있고 값이 없으면 줄 전체가 「＋ 추가」, 값이 있으면 칩 뒤 작은 「＋」. picker 가 없으면(권한 없음·읽기 전용) 값만 — 비면 「없음」.
 * 피커는 두 경우 모두 같은 자리(마지막 자식)에 둬서, 첫 값을 붙인 뒤에도 팝오버·트리거가 다시 만들어지지 않는다.
 * 값은 담당자 값과 같은 선(px-3)·같은 높이(min-h-9)에서 시작한다.
 */
export function PropertyChipRow({
  label,
  testId,
  valuesTestId,
  empty,
  picker,
  children,
}: {
  label: string;
  testId: string;
  valuesTestId: string;
  empty: boolean;
  /** 고르기 — 트리거 모양을 받아 피커를 그린다. 없으면 고르기 없이 값만. */
  picker?: (trigger: 'row' | 'icon') => ReactNode;
  /** 칩들. */
  children: ReactNode;
}) {
  const rowTrigger = picker && empty;
  return (
    <div className="space-y-1" data-testid={testId}>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <div className={cn('flex flex-wrap items-center gap-1', !rowTrigger && 'min-h-9 px-3 py-1.5')} data-testid={valuesTestId}>
        {children}
        {empty && !picker && <span className="text-sm text-muted-foreground">없음</span>}
        {picker?.(rowTrigger ? 'row' : 'icon')}
      </div>
    </div>
  );
}
