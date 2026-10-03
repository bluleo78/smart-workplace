// 감사 로그 사용자 필터 — 검색형 단일 선택 (WP-183).
// 구성원 디렉터리를 검색어로 서버 조회하므로 인원 수와 무관하게 누구든 찾을 수 있다.
// 비활성 구성원의 과거 행위도 찾아야 하므로 includeInactive, 에이전트 행위도 감사 대상이라 kind=ALL.
import { Check, ChevronDown } from 'lucide-react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMembers } from '@/hooks/queries/useMembers';
import { useDebounceValue } from '@/hooks/useDebounceValue';
import { cn } from '@/lib/utils';

/** 선택된 사용자 — 트리거에 이름을 보이기 위해 id 외에 표시 정보도 들고 있는다(검색 결과가 바뀌어도 유지). */
export interface AuditUserSelection {
  userId: number;
  name: string;
  username: string;
}

export function AuditUserFilter({
  value,
  onChange,
}: {
  value: AuditUserSelection | null;
  onChange: (next: AuditUserSelection | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounceValue(query.trim(), 300);
  // 팝오버가 열렸을 때만 조회 — 감사 로그 화면 진입만으로 구성원 목록을 받지 않는다.
  const members = useMembers(
    { search: debounced || undefined, kind: 'ALL', includeInactive: true, size: 20 },
    { enabled: open },
  );

  // 선택 후 닫고 검색어 초기화 — 다음에 열면 기본 후보부터 보인다.
  const select = (next: AuditUserSelection | null) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="사용자 필터"
          className="min-w-0 flex-1 justify-between font-normal sm:w-[180px] sm:flex-none"
        >
          {/* 동명이인을 구분하도록 아이디도 함께(좁으면 잘림 — title 로 전체 확인) */}
          <span className="truncate" title={value ? `${value.name} (${value.username})` : undefined}>
            {value ? (
              <>
                {value.name} <span className="text-muted-foreground">({value.username})</span>
              </>
            ) : (
              '전체 사용자'
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start" data-testid="audit-user-filter-popover">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="이름·아이디로 검색"
            aria-label="사용자 검색"
          />
          <CommandList>
            {members.isLoading ? (
              <CommandEmpty>검색 중…</CommandEmpty>
            ) : members.isError ? (
              <CommandEmpty>검색에 실패했습니다</CommandEmpty>
            ) : (
              <>
                {/* 검색 결과가 없으면 자동 표시(shouldFilter=false 여도 렌더된 항목이 없으면 보인다) */}
                <CommandEmpty>일치하는 사용자가 없습니다</CommandEmpty>
                <CommandGroup>
                  {/* 검색어가 없을 때만 '전체 사용자'(필터 해제) 항목을 맨 위에 둔다 */}
                  {!debounced && (
                    <CommandItem value="all" onSelect={() => select(null)}>
                      <Check className={cn('h-4 w-4', value ? 'opacity-0' : 'opacity-100')} />
                      전체 사용자
                    </CommandItem>
                  )}
                  {(members.data?.content ?? []).map((m) => (
                    <CommandItem
                      key={m.userId}
                      value={String(m.userId)}
                      onSelect={() => select({ userId: m.userId, name: m.name, username: m.username })}
                      data-testid={`audit-user-option-${m.userId}`}
                    >
                      <Check className={cn('h-4 w-4', value?.userId === m.userId ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate">
                        {m.name} <span className="text-muted-foreground">({m.username})</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
