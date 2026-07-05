// 프로젝트 멤버 추가/DM 수신자 검색 등에 재사용되는 사용자 검색 popover.
// - 300ms debounce 후 GET /users?search=&kind= 호출
// - kind 필터 토글 (전체 | 사람 | AGENT) — 탭 UI 는 항상 노출하되, 실제 검색 범위는 includeAgents/agentOnly 로 결정
//   (#691 — 백엔드가 kind 파라미터를 실제로 필터링하므로, 팀 프로젝트 멤버 추가처럼 여전히 사람만 필요한 호출부는
//   includeAgents 를 넘기지 않아 기존 동작(HUMAN 전용)을 그대로 유지한다)
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
  // 검색 결과에서 완전히 제외할 사용자 id(예: DM compose 의 본인). 미전달 시 제외 없음.
  excludeUserIds?: Set<number>;
  // true 면 AGENT 만 선택 가능 — kind 토글 숨기고 AGENT 필터 고정 (개인 프로젝트 AI 추가 전용).
  agentOnly?: boolean;
  // true 면 검색 결과에 AGENT 도 포함(DM 수신자 검색 등). 미전달/false 면 HUMAN 만 조회하는 기존 동작 유지
  // — 팀 프로젝트 멤버 추가처럼 실제로 사람만 필요한 호출부는 이 prop 을 넘기지 않는다.
  includeAgents?: boolean;
}

export function MemberSearchPopover({
  open,
  onOpenChange,
  existingMemberIds,
  onSelect,
  trigger,
  excludeUserIds,
  agentOnly = false,
  includeAgents = false,
}: MemberSearchPopoverProps) {
  const [query, setQuery] = useState('');
  // agentOnly 모드면 AGENT 필터 고정 — 사람 토글 노출 안 함.
  const [kindFilter, setKindFilter] = useState<KindFilter>(agentOnly ? 'AGENT' : 'ALL');
  const debounced = useDebounceValue(query, 300);
  // 실제 백엔드 조회 범위 — agentOnly 면 AGENT 만, includeAgents 면 ALL(HUMAN+AGENT), 그 외엔 HUMAN 만(기존 동작).
  const searchKind = agentOnly ? 'AGENT' : includeAgents ? 'ALL' : 'HUMAN';
  const search = useUserSearch(debounced, searchKind);

  // kind 탭 필터 적용 — 백엔드가 이미 searchKind 로 범위를 좁혔으므로, 여기선 탭 UI(전체/사람/에이전트) 선택을
  // 클라이언트에서 추가로 좁히는 역할만 한다.
  const items = (search.data?.content ?? [])
    .filter((u) => !excludeUserIds?.has(u.id)) // 본인 등 제외 대상
    .filter((u) => (kindFilter === 'ALL' ? true : u.kind === kindFilter));

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
          {/* agentOnly 모드면 kind 토글 숨김 — AGENT 만 선택 가능하므로 토글 불필요. */}
          {!agentOnly && (
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
                  {k === 'ALL' ? '전체' : k === 'HUMAN' ? '사람' : '에이전트'}
                </Button>
              ))}
            </div>
          )}
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
