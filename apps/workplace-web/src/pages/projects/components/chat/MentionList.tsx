// TipTap mention suggestion 팝업의 옵션 리스트.
// 키보드 네비(↑↓ Enter)는 forwardRef 의 onKeyDown 으로 노출 — suggestion render 가 위임 호출.

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

import { AgentBadge } from '../../../../components/users/AgentBadge';
import type { ChatMemberResponse } from '../../../../types/chat';

export interface MentionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface MentionListProps {
  items: ChatMemberResponse[];
  command: (item: { id: number; label: string }) => void;
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);

    useEffect(() => setSelected(0), [items]);

    function select(index: number) {
      const item = items[index];
      if (item) command({ id: item.userId, label: item.name });
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelected((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelected((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          select(selected);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) return null;

    return (
      <div
        role="listbox"
        aria-label="멘션 후보"
        className="w-72 overflow-auto rounded-md border bg-popover shadow-md"
        data-testid="chat-mention-popover"
      >
        {items.map((m, idx) => (
          <button
            type="button"
            key={m.userId}
            role="option"
            aria-selected={idx === selected}
            data-testid={`chat-mention-option-${m.userId}`}
            data-agent={m.kind === 'AGENT' ? 'true' : undefined}
            onMouseEnter={() => setSelected(idx)}
            onClick={() => select(idx)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
              idx === selected ? 'bg-accent' : ''
            }`}
          >
            <span className="font-medium">{m.name}</span>
            {m.kind === 'AGENT' && <AgentBadge size="xs" />}
          </button>
        ))}
      </div>
    );
  },
);
MentionList.displayName = 'MentionList';
