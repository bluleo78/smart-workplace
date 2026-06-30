// 이슈 담당자 다중 선택 픽커 — LabelPickerPopover 와 동일 패턴.
// 팝오버가 열릴 때 current 를 selected 로 reset, 닫힐 때 변경된 집합만 PUT 호출.

import { UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { AgentBadge } from '../../../components/users/AgentBadge';
import { UserAvatar } from '../../../components/users/UserAvatar';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useUpdateIssueAssignees } from '../../../hooks/queries/useUpdateIssueAssignees';
import type { UserSummary } from '../../../types/user';

export function AssigneePickerPopover({
  projectKey,
  issueNumber,
  current,
}: {
  projectKey: string;
  issueNumber: number;
  current: UserSummary[];
}) {
  const members = useProjectMembers(projectKey);
  const update = useUpdateIssueAssignees(projectKey, issueNumber);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>(() => current.map((u) => u.id));

  // 이름/유저명 부분일치 검색 — 대소문자 무시.
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (members.data ?? []).filter((m) =>
      `${m.name} ${m.username}`.toLowerCase().includes(q),
    );
  }, [members.data, search]);

  function toggle(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // 열릴 때: 외부 갱신 반영을 위해 selected 를 current 로 reset.
  // 닫힐 때: 정렬 후 비교해 변경된 경우만 mutate — 동일하면 네트워크 호출 X.
  function onOpenChange(next: boolean) {
    if (next) {
      setSelected(current.map((u) => u.id));
      setSearch('');
    } else {
      const before = current
        .map((u) => u.id)
        .sort((a, b) => a - b)
        .join(',');
      const after = [...selected].sort((a, b) => a - b).join(',');
      if (before !== after) update.mutate(selected);
    }
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {/* 담당자 필드 — 값(담당자/미지정)을 보여주는 풀폭 인라인 필드.
            평소 borderless, 호버 시 보더+배경(편집 가능 신호). 클릭→팝오버, 외부클릭→닫힘(Radix). */}
        <button
          type="button"
          aria-label="담당자 편집"
          data-testid="assignee-picker-trigger"
          className="flex w-full items-center rounded-md border border-transparent px-3 py-2 text-left text-sm transition-colors hover:border-input hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex flex-1 flex-wrap items-center gap-2" data-testid="issue-assignees">
            {current.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <UserPlus className="h-4 w-4" />
                미지정
              </span>
            ) : (
              current.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1"
                  data-testid={`issue-assignee-${u.id}`}
                >
                  {/* AGENT 는 별도 칩 대신 아바타에 에이전트 표식(ring + Bot 마커). */}
                  <UserAvatar user={u} size="xs" agent={u.kind === 'AGENT'} />
                  <span>{u.name}</span>
                </span>
              ))
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" data-testid="assignee-picker">
        <Input
          placeholder="멤버 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2"
          aria-label="멤버 검색"
        />
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filtered.map((m) => (
            <label
              key={m.userId}
              className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-accent"
              data-testid={`assignee-option-${m.userId}`}
              data-agent={m.kind === 'AGENT' ? 'true' : undefined}
            >
              <input
                type="checkbox"
                checked={selected.includes(m.userId)}
                onChange={() => toggle(m.userId)}
                aria-label={m.name}
              />
              <UserAvatar
                user={{ id: m.userId, username: m.username, name: m.name }}
                size="xs"
              />
              <span className="text-sm">{m.name}</span>
              <span className="text-xs text-muted-foreground">@{m.username}</span>
              {m.kind === 'AGENT' && <AgentBadge size="xs" />}
            </label>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground py-2 text-center">결과 없음</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
