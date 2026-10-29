// 이슈 담당자 다중 선택 픽커 — LabelPickerPopover 와 동일 패턴.
// 팝오버가 열릴 때 current 를 selected 로 reset, 닫힐 때 변경된 집합만 PUT 호출.

import { UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { labelWithValue } from '@/lib/labelWithValue';
import { cn } from '@/lib/utils';

import { INLINE_FIELD_CLASS, INLINE_FIELD_RAIL_CLASS } from '../../../components/issue/inlineField';
import { AgentBadge } from '../../../components/users/AgentBadge';
import { AssigneeAvatar, CandidateAvatar } from '../../../components/users/UserAvatar';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useUpdateIssueAssignees } from '../../../hooks/queries/useUpdateIssueAssignees';
import { assigneeCandidates } from '../../../lib/assigneeCandidates';
import { toSummary } from '../../../lib/issueRowMenu';
import { displayNameWithStatus, isInactiveUser } from '../../../lib/userStatus';
import type { UserSummary } from '../../../types/user';

export function AssigneePickerPopover({
  projectKey,
  issueNumber,
  current,
  disabled = false,
}: {
  projectKey: string;
  issueNumber: number;
  current: UserSummary[];
  /** 워크플로 편집 권한 없을 때 트리거 비활성화 — IssuePropertyRail 과 동일 idiom. */
  disabled?: boolean;
}) {
  const members = useProjectMembers(projectKey);
  const update = useUpdateIssueAssignees(projectKey, issueNumber);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>(() => current.map((u) => u.id));

  // 이름/유저명 부분일치 검색 — 대소문자 무시.
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    // 비활성 구성원은 후보에서 빼되, 이미 담당 중이면 해제할 수 있게 남긴다(WP-487).
    return assigneeCandidates(members.data, current.map((u) => u.id)).filter((m) =>
      `${m.name} ${m.username}`.toLowerCase().includes(q),
    );
  }, [members.data, search, current]);

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
            평소 borderless, 호버 시 보더+배경(편집 가능 신호). 클릭→팝오버, 외부클릭→닫힘(Radix).
            이름에 보이는 값(담당자 이름들/미지정)을 붙인다 — aria-label 이 안쪽 글자를 덮어써 값을 못 읽었다(WP-853). */}
        <button
          type="button"
          aria-label={labelWithValue('담당자 편집', current.length === 0 ? '미지정' : current.map(displayNameWithStatus).join(', '))}
          data-testid="assignee-picker-trigger"
          disabled={disabled}
          className={cn(INLINE_FIELD_RAIL_CLASS, INLINE_FIELD_CLASS)}
        >
          <span className="flex flex-1 flex-wrap items-center gap-2" data-testid="issue-assignees">
            {current.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <UserPlus className="h-4 w-4" />
                미지정
              </span>
            ) : (
              current.map((u) => {
                const inactive = isInactiveUser(u);
                return (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1"
                    data-testid={`issue-assignee-${u.id}`}
                  >
                    {/* AGENT 는 별도 칩 대신 아바타에 에이전트 표식(ring + Bot 마커). */}
                    <AssigneeAvatar user={u} size="xs" />
                    {/* 정지된 담당자는 흐린 이름 + 「비활성」 배지(WP-1080) */}
                    <span className={cn(inactive && 'text-muted-foreground')}>{u.name}</span>
                    {inactive && (
                      <StatusBadge type="inactive" className="shrink-0" data-testid={`issue-assignee-${u.id}-inactive`}>
                        비활성
                      </StatusBadge>
                    )}
                  </span>
                );
              })
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
              // WP-461: 이름·아이디는 각자 한 줄 말줄임(멤버 검색 팝오버와 같은 규칙) — 긴 이름이 글자 단위로 여러 줄 쪼개지던 문제.
              // 이름이 먼저 자기 폭을 갖고, 아이디는 남는 자리만 쓴다(basis-0 flex-1) — 짧은 이름이 긴 아이디 때문에 잘리지 않게. 전체 값은 title 로 본다.
              className="flex min-w-0 items-center gap-2 cursor-pointer p-1 rounded hover:bg-accent"
              data-testid={`assignee-option-${m.userId}`}
              data-agent={m.kind === 'AGENT' ? 'true' : undefined}
              title={`${m.name} @${m.username}`}
            >
              <input
                type="checkbox"
                className="shrink-0"
                checked={selected.includes(m.userId)}
                // 비활성 구성원은 해제만 — 다시 고르면 서버가 거부한다(WP-487).
                disabled={isInactiveUser(m) && !selected.includes(m.userId)}
                onChange={() => toggle(m.userId)}
                aria-label={m.name}
              />
              {/* 위쪽 담당자 칸과 같은 표기(WP-1100) — 정지된 구성원은 회색 아바타 + 「비활성」 배지.
                  이름·AgentBadge·「비활성」 배지가 글자로 함께 있어 아바타는 장식으로 두고 AI 표식도 뺀다(WP-1160 — AI·비활성을 두 번 표시·낭독). */}
              <CandidateAvatar user={toSummary(m)} />
              <span className="min-w-0 truncate text-sm">{m.name}</span>
              <span className="min-w-0 flex-1 basis-0 truncate text-xs text-muted-foreground">@{m.username}</span>
              {m.kind === 'AGENT' && <AgentBadge size="xs" />}
              {isInactiveUser(m) && (
                <StatusBadge type="inactive" className="shrink-0" data-testid={`assignee-option-${m.userId}-inactive`}>
                  비활성
                </StatusBadge>
              )}
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
