// 프로젝트 멤버 추가/DM 수신자 검색 등에 재사용되는 사용자 검색 popover.
// - 300ms debounce 후 GET /users?search=&kind= 호출. 검색어가 비어 있으면 해당 kind 의 기본 후보 목록을 조회(#734)
// - kind 필터 토글 (전체 | 사람 | 에이전트) — 선택한 탭이 곧 백엔드 kind 파라미터가 된다(#734).
//   클라이언트에서 kind 를 다시 거르지 않는 이유: page 1(20건)에 AGENT 가 안 들어오면 탭이 계속 빈 목록이 되기 때문.
//   AGENT 를 아예 다룰 수 없는 호출부(includeAgents 미전달)는 에이전트 탭 자체를 숨겨 탭이 거짓말하지 않게 한다.
// - 비활성(is_active=false) 사용자는 후보에서 제외 — 추가 대상이 될 수 없다
// - 이미 멤버인 후보는 disabled + "(이미 멤버)" 라벨, 목록 뒤로 정렬(기본 목록이 disabled 행으로만 차는 것 방지)
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
  // true 면 kind 탭(전체/사람/에이전트)을 노출하고 AGENT 도 후보에 포함(DM 수신자, 프로젝트 멤버 추가 등).
  // 미전달/false 면 에이전트 탭을 숨기고 HUMAN 만 조회한다(사람만 다루는 호출부).
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
  // 실제 백엔드 조회 범위 — agentOnly 면 AGENT 고정, kind 탭을 노출하는 경우엔 선택한 탭이 곧 조회 범위,
  // 탭이 없는(사람 전용) 호출부는 HUMAN 고정.
  const searchKind = agentOnly ? 'AGENT' : includeAgents ? kindFilter : 'HUMAN';
  const search = useUserSearch(debounced, searchKind);

  // 후보 목록 — 백엔드가 kind/검색어로 이미 좁혔으므로 여기선 제외 대상·비활성 사용자만 걸러내고,
  // 이미 멤버인 후보를 뒤로 보낸다(검색어 없는 기본 목록의 앞줄이 선택 불가 행으로 채워지지 않게).
  const items = (search.data?.content ?? [])
    .filter((u) => !excludeUserIds?.has(u.id)) // 본인 등 제외 대상
    .filter((u) => u.isActive !== false) // 비활성 사용자는 추가 대상 아님
    .sort(
      (a, b) => Number(existingMemberIds.has(a.id)) - Number(existingMemberIds.has(b.id)),
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
          {/* agentOnly 면 AGENT 고정이라 토글 불필요, includeAgents 아니면 HUMAN 고정이라 토글이 의미 없음 —
              둘 중 하나면 탭 자체를 숨긴다(누르면 결과가 없는 '에이전트' 탭 노출 방지, #734). */}
          {!agentOnly && includeAgents && (
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
            {/* 검색어가 없어도 기본 후보 목록을 그대로 렌더한다(#734). 안내 문구는 CommandInput placeholder 로 대체. */}
            {search.isLoading ? (
              <CommandEmpty>검색 중…</CommandEmpty>
            ) : search.isError ? (
              <CommandEmpty>검색에 실패했습니다</CommandEmpty>
            ) : items.length === 0 ? (
              <CommandEmpty>
                {debounced.trim().length < 1 ? '추가할 수 있는 후보가 없습니다' : '결과가 없습니다'}
              </CommandEmpty>
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
