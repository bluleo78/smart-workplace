// 메일 편집 툴바 버튼 — 작성창(MailComposer)·서식 둘째 줄(MailFormatRow)·서명 편집기가 같이 쓴다.
// MailComposer 안에 있으면 MailFormatRow 와 import 가 순환하므로 따로 둔다.
import type { ReactNode } from 'react';

import { ghostToggleClass } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';

/**
 * 툴바 버튼 — 누를 때 편집기 초점을 뺏지 않는다.
 * touch(모바일)는 44px 터치 크기·20px 아이콘, 그 밖엔 작은 버튼·16px 아이콘. title 은 마우스를 올리면 보이는 이름.
 * disabled 면 흐리게 보이고 눌리지 않는다(예: 더 내어쓸 수 없을 때 내어쓰기).
 */
export function ToolbarButton({
  active,
  touch = false,
  disabled,
  expanded,
  controls,
  onClick,
  label,
  title,
  className,
  children,
}: {
  active?: boolean;
  touch?: boolean;
  disabled?: boolean;
  /** 펼침 토글이면 지금 펼쳐졌는지(aria-expanded). */
  expanded?: boolean;
  /** 펼침 토글이 여닫는 영역의 id(aria-controls). */
  controls?: string;
  onClick: () => void;
  label: string;
  title?: string;
  /** 덧붙일 클래스 — 표 막대의 삭제 단추 파괴적 색(text-destructive) 등. 뒤에 붙어 기본 글자색을 덮는다. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      aria-pressed={active}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'rounded text-muted-foreground hover:bg-accent hover:text-foreground',
        touch ? 'flex h-11 w-11 items-center justify-center [&_svg]:size-5' : 'p-1.5 [&_svg]:size-4',
        disabled && 'pointer-events-none opacity-50',
        ghostToggleClass(!!active),
        className,
      )}
    >
      {children}
    </button>
  );
}
