// 워크플로 필드 잠김 표시(WP-503) — 유형·상태 등이 권한으로 막혔을 때 속성 줄 끝에 작게 두고, 누르면 이유를 팝오버로 보여 준다.
// 왜: 비활성 필드가 흐리게만 보여 OPEN 비멤버가 「기능이 없다」고 받아들였다(VOC WPV-8). 안내 문장을 늘 펼쳐 두면 제목 아래 공간을
// 한 줄 더 차지하므로 짧은 표시 + 탭/클릭으로 연다(비활성 버튼엔 툴팁이 뜨지 않고 모바일엔 호버가 없어 팝오버를 쓴다).
import { Lock } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { MOBILE_CHIP } from './mobile/chipStyles';

/**
 * variant — inline: 데스크톱 유형 배지 옆 「멤버만 변경」, chip: 모바일 칩 줄 끝 자물쇠 칩(둘 다 누르면 팝오버),
 * line: 모바일 「속성」 시트 맨 위에 문구를 펼친 한 줄(시트는 공간이 넉넉하다).
 */
export function WorkflowLockedHint({ message, variant }: { message: string; variant: 'inline' | 'chip' | 'line' }) {
  if (variant === 'line') {
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground break-keep" data-testid="issue-workflow-locked-notice">
        <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
        {message}
      </p>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // 아이콘만 있는 칩에만 이름을 준다 — inline 은 보이는 「멤버만 변경」이 그대로 접근 이름이어야 한다(WCAG 2.5.3).
          aria-label={variant === 'chip' ? '변경 권한 안내' : undefined}
          data-testid="issue-workflow-locked-hint"
          className={
            variant === 'chip'
              ? cn(MOBILE_CHIP, 'text-muted-foreground')
              : 'inline-flex min-h-6 items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground'
          }
        >
          <Lock className={variant === 'chip' ? 'size-4' : 'size-3'} aria-hidden />
          {variant === 'inline' && '멤버만 변경'}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 text-sm break-keep" data-testid="issue-workflow-locked-popover">
        {message}
      </PopoverContent>
    </Popover>
  );
}
