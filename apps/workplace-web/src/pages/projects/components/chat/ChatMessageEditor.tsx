// 본인 메시지 수정용 인라인 에디터.
// Enter = 저장, Esc = 취소, Shift+Enter = 줄바꿈.

import { useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { Textarea } from '../../../../components/ui/textarea';

interface ChatMessageEditorProps {
  initialBody: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}

export function ChatMessageEditor({ initialBody, onSave, onCancel }: ChatMessageEditorProps) {
  const [body, setBody] = useState(initialBody);

  function save() {
    const trimmed = body.trim();
    if (trimmed.length === 0 || trimmed === initialBody.trim()) {
      onCancel();
      return;
    }
    onSave(trimmed);
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2" data-testid="chat-message-editor">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        autoFocus
        rows={2}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label="메시지 수정"
        data-testid="chat-message-editor-input"
      />
      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          data-testid="chat-message-editor-cancel"
        >
          취소
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={save}
          data-testid="chat-message-editor-save"
        >
          저장
        </Button>
      </div>
    </div>
  );
}
