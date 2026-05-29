// chat 메시지 작성 폼.
// Enter = 전송, Shift+Enter = 줄바꿈.
// '@' 입력 시 ChatMentionPopover 열림, ↑↓ Enter Tab 으로 선택.
// 전송은 onSubmit(body) 호출 — optimistic 처리는 부모(useCreateChatMessage)가 담당.

import { useRef, useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { Textarea } from '../../../../components/ui/textarea';
import type { ChatMemberResponse } from '../../../../types/chat';
import { ChatMentionPopover } from './ChatMentionPopover';
import { detectMention } from './detectMention';

interface ChatComposerProps {
  members: ChatMemberResponse[];
  onSubmit: (body: string) => void;
  disabled?: boolean;
}

export function ChatComposer({ members, onSubmit, disabled = false }: ChatComposerProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filteredMembers = (() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    if (q === '') return members.slice(0, 8);
    return members
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q),
      )
      .slice(0, 8);
  })();

  function refreshMention() {
    const ta = taRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const det = detectMention(before);
    setMentionQuery(det?.query ?? null);
    setSelectedIdx(0);
  }

  function applyMention(member: ChatMemberResponse) {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const before = ta.value.slice(0, caret);
    const det = detectMention(before);
    if (!det) return;
    const insertion = `@${member.username} `;
    const newBefore = before.slice(0, det.anchor) + insertion;
    const after = ta.value.slice(caret);
    const newValue = newBefore + after;
    setBody(newValue);
    setMentionQuery(null);
    // caret 위치 보정.
    requestAnimationFrame(() => {
      if (!taRef.current) return;
      const pos = newBefore.length;
      taRef.current.setSelectionRange(pos, pos);
      taRef.current.focus();
    });
  }

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0 || disabled) return;
    onSubmit(trimmed);
    setBody('');
    setMentionQuery(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 한글/일어 등 IME 조합 중 Enter 는 마지막 음절 확정용이므로
    // 전송·멘션선택으로 처리하지 않는다 (안 그러면 "안녕"/"녕" 중복 전송).
    if (e.nativeEvent.isComposing) return;
    const popoverOpen = mentionQuery !== null && filteredMembers.length > 0;
    if (popoverOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % filteredMembers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + filteredMembers.length) % filteredMembers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyMention(filteredMembers[selectedIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="relative flex gap-2 border-t p-3" data-testid="chat-composer">
      <Textarea
        ref={taRef}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          // change 가 먼저 발생하고 selection 이 그 직후 갱신되므로 RAF 후 검사.
          requestAnimationFrame(refreshMention);
        }}
        onKeyUp={refreshMention}
        onClick={refreshMention}
        onKeyDown={onKeyDown}
        placeholder="메시지 입력 (Shift+Enter 로 줄바꿈)"
        aria-label="채팅 메시지 작성"
        data-testid="chat-composer-input"
        rows={2}
        disabled={disabled}
        className="resize-none"
      />
      {mentionQuery !== null && (
        <ChatMentionPopover
          members={filteredMembers}
          selectedIndex={selectedIdx}
          onSelect={applyMention}
          onHoverIndex={setSelectedIdx}
        />
      )}
      <Button
        type="button"
        onClick={submit}
        disabled={disabled || body.trim().length === 0}
        data-testid="chat-composer-submit"
      >
        보내기
      </Button>
    </div>
  );
}
