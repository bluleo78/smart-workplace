// 에픽 색 고르기(WP-1017) — 이슈 상세 속성 레일(데스크톱)·속성 시트(모바일)의 맨 위, 에픽일 때만.
// 새 에픽은 서버가 자동 색을 붙이고, 여기서 라벨과 같은 12색 견본으로 바꾼다. 고르면 곧바로 저장하고 팝오버를 닫는다(마일스톤 고르개와 같은 단일 선택).

import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Button } from '@/components/ui/button';
import { labelWithValue } from '@/lib/labelWithValue';
import { cn } from '@/lib/utils';

import { useUpdateEpicColor } from '../../../hooks/queries/useUpdateEpicColor';
import { epicDotClass } from '../../../lib/epicColor';
import { COLOR_TOKEN_LABELS, type ColorToken } from '../../../types/label';
import { ColorTokenPicker } from './ProjectMetaEditDialog';

interface EpicColorFieldProps {
  projectKey: string;
  issueNumber: number;
  /** 지금 에픽 색 토큰 — 색을 정하기 전(구 서버가 만든 에픽)이면 null/undefined. */
  epicColor: string | null | undefined;
  /** 유형 색 — 에픽 색이 없을 때 대신 보이는 색(목록·타임라인도 같은 대체 규칙). */
  fallbackColor?: string;
  /** 바꿀 수 없으면(비멤버 등) 값만 보이고 누를 수 없다. */
  disabled?: boolean;
}

export function EpicColorField({ projectKey, issueNumber, epicColor, fallbackColor, disabled }: EpicColorFieldProps) {
  const [open, setOpen] = useState(false);
  const update = useUpdateEpicColor(projectKey, issueNumber);
  const shown = epicColor ?? fallbackColor ?? 'GRAY';
  const name = COLOR_TOKEN_LABELS[shown as ColorToken] ?? COLOR_TOKEN_LABELS.GRAY;

  function pick(tok: ColorToken) {
    setOpen(false);
    if (tok !== epicColor) update.mutate(tok);
  }

  return (
    <div className="space-y-1" data-testid="epic-color-field">
      <span className="text-xs font-medium text-muted-foreground">에픽 색</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || update.isPending}
            // 보이는 값(색 이름)을 이름에 붙인다 — aria-label 이 안쪽 글자를 덮어써 값을 못 읽지 않게(WP-853 과 같은 규칙).
            aria-label={labelWithValue('에픽 색 선택', name)}
            data-testid="epic-color-trigger"
            className="w-full justify-start gap-2 font-normal"
          >
            <span className={cn('size-3 shrink-0 rounded-full', epicDotClass(shown))} aria-hidden="true" />
            <span>{name}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" data-testid="epic-color-popover">
          {/* 견본 12개를 6열 2줄 격자로 — 좁은 모바일에서도 가로로 넘치지 않는다. 터치 기기(pointer-coarse)는 견본을 40px·간격 8px 로 키워
              손가락으로 이웃 색을 잘못 누르지 않게 한다(데스크톱은 라벨 설정과 같은 24px). */}
          <ColorTokenPicker
            value={epicColor as ColorToken}
            onChange={pick}
            ariaLabel="에픽 색"
            testIdPrefix="epic-color-option-"
            className="grid grid-cols-6 gap-1.5 pointer-coarse:gap-2"
            swatchClassName="pointer-coarse:size-10"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
