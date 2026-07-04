// 담당자 아바타 스택 필터 (#647) — 프로젝트 멤버를 상시 노출하고 클릭으로 담당자 필터를 토글한다.
// Jira 타임라인의 아바타 필터 미러. 최대 5명 + 초과분은 +N 팝오버로 폴백.
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { avatarColorClass, avatarInitials } from '@/lib/avatarColor';
import { cn } from '@/lib/utils';
import type { MemberResponse } from '@/types/project';

const MAX_VISIBLE = 5;

export interface AssigneeAvatarStackProps {
  members: MemberResponse[];
  selectedIds: number[];
  onToggle: (userId: number) => void;
}

export function AssigneeAvatarStack({ members, selectedIds, onToggle }: AssigneeAvatarStackProps) {
  if (members.length === 0) return null;
  const visible = members.slice(0, MAX_VISIBLE);
  const overflow = members.slice(MAX_VISIBLE);
  const isSelected = (id: number) => selectedIds.includes(id);

  return (
    <div className="flex items-center" data-testid="assignee-avatar-stack" role="group" aria-label="담당자 필터">
      {visible.map((m, i) => (
        <button
          key={m.userId}
          type="button"
          data-testid={`assignee-avatar-${m.userId}`}
          aria-pressed={isSelected(m.userId)}
          aria-label={`담당자 ${m.name} 필터`}
          title={m.name}
          onClick={() => onToggle(m.userId)}
          className={cn(
            'flex size-7 items-center justify-center rounded-full border-2 border-background text-xs font-medium transition-opacity',
            avatarColorClass(m.userId),
            i > 0 && '-ml-2',
            isSelected(m.userId) && 'ring-2 ring-primary',
            // 하나라도 선택되면 비선택 아바타는 흐리게 — 활성 필터를 시각적으로 강조.
            selectedIds.length > 0 && !isSelected(m.userId) && 'opacity-50',
          )}
        >
          {avatarInitials(m.name)}
        </button>
      ))}
      {overflow.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="assignee-avatar-overflow"
              aria-label={`담당자 ${overflow.length}명 더 보기`}
              className="-ml-2 flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium text-muted-foreground"
            >
              +{overflow.length}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <ul className="space-y-1">
              {overflow.map((m) => (
                <li key={m.userId}>
                  <Button
                    variant={isSelected(m.userId) ? 'secondary' : 'ghost'}
                    size="sm"
                    className="w-full justify-start gap-2"
                    onClick={() => onToggle(m.userId)}
                  >
                    <span
                      className={cn(
                        'flex size-5 items-center justify-center rounded-full text-xs',
                        avatarColorClass(m.userId),
                      )}
                    >
                      {avatarInitials(m.name)}
                    </span>
                    {m.name}
                  </Button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
