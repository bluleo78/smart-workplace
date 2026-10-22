// 보드 컬럼 헤더 ⋯ 메뉴(WP-808) — OWNER 에게만: 「이름 변경」(헤더 인라인 편집으로 전환)·「이 뒤에 상태 추가」(⋯ 에 붙은 팝오버).
// 메뉴가 닫히며 ⋯ 로 포커스를 되돌리면 막 연 입력기가 포커스를 잃으므로 메뉴의 onCloseAutoFocus 를 막는다.
// 「이 뒤에 상태 추가」 팝오버는 Trigger 없이 ⋯ 에 붙어(Anchor) 있어 Radix 가 돌아갈 곳을 모른다 — 닫힐 때 ⋯ 로 직접 돌린다.
import { MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type { ProjectStatus } from '@/types/projectStatus';

import { NewStatusPopoverBody } from './StatusNameEditor';

export function BoardColumnHeaderMenu({
  status,
  canEdit,
  statuses,
  onRename,
  onAddAfter,
}: {
  status: ProjectStatus;
  canEdit: boolean;
  // 이름 중복 검사용 상태 목록.
  statuses: ProjectStatus[];
  // 헤더를 인라인 편집으로 바꾼다(편집기는 헤더가 그린다).
  onRename: () => void;
  // 이 상태 바로 뒤(같은 범주)에 새 상태를 만든다 — 실패하면 reject(입력기가 오류를 보인다).
  onAddAfter: (name: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!canEdit) return null;
  return (
    <Popover open={adding} onOpenChange={setAdding}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={triggerRef}
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground"
              aria-label={`${status.name} 상태 메뉴`}
              data-testid={`board-col-menu-${status.id}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem onSelect={onRename}>
            <Pencil className="h-4 w-4" />
            이름 변경
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            이 뒤에 상태 추가
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent
        align="end"
        className="w-72 space-y-2 p-3"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <NewStatusPopoverBody
          subtitle={`${status.name} 뒤`}
          statuses={statuses}
          onSubmit={onAddAfter}
          onClose={() => setAdding(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
