// 프로젝트 멤버 추가용 사용자 검색 popover.
// - 300ms debounce 후 GET /users?search= 호출
// - kind 필터 토글 (전체 | 사람 | AGENT) — 클라이언트 측 필터
// - 이미 멤버인 후보는 disabled + "(이미 멤버)" 라벨
// - row 클릭 → onSelect(user). 부모가 mutation 호출.
// - 성공 시 popover 는 닫지 않고 검색어만 비움 (연속 추가). 닫기는 부모 onOpenChange.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

import { AgentBadge } from '../../../components/users/AgentBadge';
import { useUserSearch } from '../../../hooks/queries/useUserSearch';
import { useDebounceValue } from '../../../hooks/useDebounceValue';
import type { UserResponse } from '../../../types/auth';
import type { UserKind } from '../../../types/user';

type KindFilter = 'ALL' | UserKind;

export interface MemberSearchPopoverProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  existingMemberIds: Set<number>;
  onSelect: (user: UserResponse) => void | Promise<void>;
  trigger: React.ReactNode;
}

export function MemberSearchPopover({
  open,
  onOpenChange,
  existingMemberIds,
  onSelect,
  trigger,
}: MemberSearchPopoverProps) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL');
  const debounced = useDebounceValue(query, 300);
  const search = useUserSearch(debounced);

  // kind 필터 적용 — 백엔드는 kind 필터를 지원하지 않으므로 클라이언트에서 분기.
  const items = (search.data?.content ?? []).filter((u) =>
    kindFilter === 'ALL' ? true : u.kind === kindFilter,
  );

  // 후보 선택 — 이미 멤버면 무시, 아니면 부모 mutation 후 검색어만 비움.
  const handleSelect = async (user: UserResponse) => {
    if (existingMemberIds.has(user.id)) return;
    await onSelect(user);
    setQuery('');
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-[360px] p-0"
        align="start"
        data-testid="member-search-popover"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="이름·아이디·이메일로 검색"
            aria-label="멤버 검색"
          />
          <div
            className="flex gap-1 p-2 border-b"
            role="tablist"
            aria-label="kind 필터"
          >
            {(['ALL', 'HUMAN', 'AGENT'] as const).map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={kindFilter === k ? 'default' : 'ghost'}
                onClick={() => setKindFilter(k)}
                role="tab"
                aria-selected={kindFilter === k}
                data-testid={`member-search-filter-${k}`}
              >
                {k === 'ALL' ? '전체' : k === 'HUMAN' ? '사람' : 'AGENT'}
              </Button>
            ))}
          </div>
          <CommandList>
            {debounced.trim().length < 1 ? (
              <CommandEmpty>이름·아이디·이메일로 검색하세요</CommandEmpty>
            ) : search.isLoading ? (
              <CommandEmpty>검색 중…</CommandEmpty>
            ) : search.isError ? (
              <CommandEmpty>검색에 실패했습니다</CommandEmpty>
            ) : items.length === 0 ? (
              <CommandEmpty>결과가 없습니다</CommandEmpty>
            ) : (
              <CommandGroup>
                {items.map((u) => {
                  const isMember = existingMemberIds.has(u.id);
                  return (
                    <CommandItem
                      key={u.id}
                      value={String(u.id)}
                      disabled={isMember}
                      onSelect={() => void handleSelect(u)}
                      data-testid={`member-search-row-${u.id}`}
                      className="flex items-center gap-2"
                    >
                      <span className="font-medium truncate">{u.name}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        @{u.username}
                      </span>
                      {u.kind === 'AGENT' && <AgentBadge size="xs" />}
                      {isMember && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          (이미 멤버)
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
