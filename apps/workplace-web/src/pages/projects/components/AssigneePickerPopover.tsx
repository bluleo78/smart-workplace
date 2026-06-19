// 이슈 담당자 다중 선택 픽커 — LabelPickerPopover 와 동일 패턴.
// 팝오버가 열릴 때 current 를 selected 로 reset, 닫힐 때 변경된 집합만 PUT 호출.

import { Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
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
        {/* current 담당자가 있으면 아바타 목록 표시, 없으면 빈 아이콘 */}
        <Button
          variant="outline"
          size="sm"
          aria-label="담당자 편집"
          data-testid="assignee-picker-trigger"
        >
          {current.length > 0 ? (
            <div className="flex items-center gap-1">
              {current.map((u) => (
                <UserAvatar key={u.id} user={u} size="xs" />
              ))}
            </div>
          ) : (
            <Users className="h-4 w-4" />
          )}
        </Button>
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
