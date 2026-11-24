// TipTap mention suggestion 팝업의 옵션 리스트.
// 키보드 네비(↑↓ Enter)는 forwardRef 의 onKeyDown 으로 노출 — suggestion render 가 위임 호출.

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

import { AgentBadge } from '@/components/users/AgentBadge';

import type { MentionCandidate } from './types';

export interface MentionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

/** option 의 id — 편집칸 aria-activedescendant 가 가리키는 값(WP-2061). 목록 id 와 순번으로 만든다. */
// eslint-disable-next-line react-refresh/only-export-components -- 순수 id 함수라 같은 파일에 둔다(RichInput 이 같이 쓴다)
export function mentionOptionId(listId: string, index: number): string {
  return `${listId}-opt-${index}`;
}

interface MentionListProps {
  items: MentionCandidate[];
  command: (item: { id: number; label: string }) => void;
  /** listbox 의 id — 편집칸 aria-controls 가 가리킨다. */
  listId: string;
  /** 활성(선택) 후보 순번이 바뀔 때마다·처음 그릴 때 부른다. 후보가 없으면 -1. */
  onActiveChange: (index: number) => void;
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  ({ items, command, listId, onActiveChange }, ref) => {
    const [selected, setSelected] = useState(0);

    useEffect(() => setSelected(0), [items]);

    // 활성 후보를 편집칸에 알린다(aria-activedescendant 용). 후보가 없으면 -1.
    // 후보가 줄어든 첫 렌더는 selected 가 아직 옛 값이라(0 으로 되돌리는 effect 전) 끝 순번으로 잘라 없는 id 를 가리키지 않게 한다.
    const active = items.length ? Math.min(selected, items.length - 1) : -1;
    useEffect(() => onActiveChange(active), [active, onActiveChange]);

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
        id={listId}
        role="listbox"
        aria-label="멘션 후보"
        className="w-72 overflow-auto rounded-md border bg-popover shadow-md"
        data-testid="chat-mention-popover"
      >
        {items.map((m, idx) => (
          <button
            type="button"
            key={m.userId}
            id={mentionOptionId(listId, idx)}
            role="option"
            aria-selected={idx === selected}
            data-testid={`chat-mention-option-${m.userId}`}
            data-agent={m.kind === 'AGENT' ? 'true' : undefined}
            onMouseEnter={() => setSelected(idx)}
            // 누르는 순간 에디터가 포커스를 잃지 않게 한다(WP-302) — 잃으면 삽입 명령이 다음 프레임에 포커스를 되돌리기 전까지
            // 친 키가 에디터 밖으로 샌다. 슬래시 메뉴·버블 툴바와 같은 방식.
            onMouseDown={(e) => e.preventDefault()}
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
