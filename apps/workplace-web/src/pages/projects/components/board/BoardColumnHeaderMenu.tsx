// 보드 컬럼 헤더 ⋯ 메뉴(WP-808) — OWNER 에게만: 「이름 변경」(헤더 인라인 편집으로 전환)·「이 뒤에 상태 추가」(⋯ 에 붙은 팝오버)·
// 구분선 뒤 「상태 관리…」(WP-809, 설정 「상태」 섹션 — 색·순서·삭제는 거기서). MEMBER 는 설정이 읽기 전용이라 바로가기를 두지 않는다.
// 메뉴가 닫히며 ⋯ 로 포커스를 되돌리면 막 연 입력기가 포커스를 잃으므로 메뉴의 onCloseAutoFocus 를 막는다.
// 「이 뒤에 상태 추가」 팝오버는 Trigger 없이 ⋯ 에 붙어(Anchor) 있어 Radix 가 돌아갈 곳을 모른다 — 닫힐 때 ⋯ 로 직접 돌린다.
import { MoreHorizontal, Pencil, Plus, Settings2 } from 'lucide-react';
import { type RefObject, useId, useRef, useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/overlay/popover';
import { Button } from '@/components/ui/button';
import { statusAddBlockedReason } from '@/lib/projectStatuses';
import type { ProjectStatus } from '@/types/projectStatus';

import { NewStatusPopoverBody } from './StatusNameEditor';

export function BoardColumnHeaderMenu({
  status,
  canEdit,
  statuses,
  triggerRef: triggerRefProp,
  onRename,
  onAddAfter,
  onManage,
}: {
  status: ProjectStatus;
  canEdit: boolean;
  // 이름 중복 검사·상한(20개) 판정용 상태 목록.
  statuses: ProjectStatus[];
  // ⋯ 버튼 ref — 넘기면 호출부(컬럼)가 인라인 이름 변경이 끝난 뒤 이 버튼으로 포커스를 돌린다. 없으면 내부 ref.
  triggerRef?: RefObject<HTMLButtonElement | null>;
  // 헤더를 인라인 편집으로 바꾼다(편집기는 헤더가 그린다).
  onRename: () => void;
  // 이 상태 바로 뒤(같은 범주)에 새 상태를 만든다 — 실패하면 reject(입력기가 오류를 보인다).
  onAddAfter: (name: string) => Promise<void>;
  // 설정 「상태」 섹션으로 간다 — 없으면 항목을 그리지 않는다.
  onManage?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const ownTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = triggerRefProp ?? ownTriggerRef;
  const reasonId = useId();
  if (!canEdit) return null;
  const addBlocked = statusAddBlockedReason(statuses);
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
          {/* 상한(20개)이면 설정 「+ 추가」처럼 막고 같은 이유를 보인다 — 막힌 항목엔 호버 툴팁이 뜨지 않아 글로 둔다.
              막힌 항목은 통째로 흐려지므로(opacity) 이유는 항목 밖에 또렷한 글자로 두고 aria-describedby 로 잇는다(설정 행 메뉴와 같은 방식, WP-809). */}
          <DropdownMenuItem
            disabled={!!addBlocked}
            aria-describedby={addBlocked ? reasonId : undefined}
            onSelect={() => setAdding(true)}
            data-testid="board-col-add-after"
          >
            <Plus className="h-4 w-4" />
            이 뒤에 상태 추가
          </DropdownMenuItem>
          {addBlocked && (
            <p id={reasonId} className="max-w-56 px-2 pb-1.5 pl-8 text-xs text-muted-foreground" data-testid="board-col-add-after-reason">
              {addBlocked}
            </p>
          )}
          {onManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onManage}>
                <Settings2 className="h-4 w-4" />
                상태 관리…
              </DropdownMenuItem>
            </>
          )}
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
