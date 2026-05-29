// @mention typeahead 옵션 리스트.
// 키보드 이벤트는 부모(ChatComposer)에서 textarea onKeyDown 으로 처리,
// 여기서는 옵션 시각화 + 마우스 클릭만 담당.

import { AgentBadge } from '../../../../components/users/AgentBadge';
import type { ChatMemberResponse } from '../../../../types/chat';

interface ChatMentionPopoverProps {
  members: ChatMemberResponse[];
  selectedIndex: number;
  onSelect: (member: ChatMemberResponse) => void;
  onHoverIndex: (idx: number) => void;
}

export function ChatMentionPopover({
  members,
  selectedIndex,
  onSelect,
  onHoverIndex,
}: ChatMentionPopoverProps) {
  if (members.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="멘션 후보"
      className="absolute bottom-full left-0 mb-1 w-72 rounded-md border bg-popover shadow-md max-h-64 overflow-auto z-50"
      data-testid="chat-mention-popover"
    >
      {members.map((m, idx) => (
        <button
          type="button"
          key={m.userId}
          role="option"
          aria-selected={idx === selectedIndex}
          data-testid={`chat-mention-option-${m.userId}`}
          data-agent={m.kind === 'AGENT' ? 'true' : undefined}
          onMouseDown={(e) => {
            // mousedown 으로 처리 — click 은 textarea blur 가 먼저 발생해 popover 가 사라지는 경우 있음.
            e.preventDefault();
            onSelect(m);
          }}
          onMouseEnter={() => onHoverIndex(idx)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
            idx === selectedIndex ? 'bg-accent' : ''
          }`}
        >
          <span className="font-medium">{m.name}</span>
          <span className="text-muted-foreground">@{m.username}</span>
          {m.kind === 'AGENT' && <AgentBadge size="xs" />}
        </button>
      ))}
    </div>
  );
}
