// TipTap 기반 chat 입력 공용 컴포넌트 (composer/editor 공용).
// mention 칩 + @ suggestion. Enter=onSubmit, Shift+Enter=줄바꿈, Esc=onCancel.
// IME(한글 조합)는 ProseMirror 가 처리. 전송 후 clearOnSubmit 이면 비우고 포커스 유지.

import './chat-rich-input.css';

import Document from '@tiptap/extension-document';
import Mention from '@tiptap/extension-mention';
import Paragraph from '@tiptap/extension-paragraph';
import Placeholder from '@tiptap/extension-placeholder';
import Text from '@tiptap/extension-text';
import { EditorContent, ReactRenderer, useEditor } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { useEffect, useRef } from 'react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';

import { Button } from '../../../../components/ui/button';
import type { ChatMemberResponse, ChatMentionResponse } from '../../../../types/chat';
import { MentionList, type MentionListHandle } from './MentionList';
import { bodyToDoc, serializeToBody } from './mentionSerialize';

interface ChatRichInputProps {
  members: ChatMemberResponse[];
  initialBody?: string;
  initialMentions?: ChatMentionResponse[];
  placeholder?: string;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  submitLabel?: string;
  clearOnSubmit?: boolean;
  autoFocus?: boolean;
  inputTestId: string;
  submitTestId: string;
  cancelTestId?: string;
}

export function ChatRichInput({
  members,
  initialBody = '',
  initialMentions = [],
  placeholder = '메시지 입력 (Shift+Enter 로 줄바꿈)',
  onSubmit,
  onCancel,
  submitLabel = '보내기',
  clearOnSubmit = false,
  autoFocus = false,
  inputTestId,
  submitTestId,
  cancelTestId,
}: ChatRichInputProps) {
  // members 최신값을 suggestion 콜백에서 참조하기 위한 ref.
  // (콜백은 useEditor 가 생성한 클로저에서 호출되므로, 렌더 시점이 아닌 effect 에서 최신값 동기화)
  const membersRef = useRef(members);
  useEffect(() => {
    membersRef.current = members;
  });

  // 멘션 팝업 활성 여부를 인스턴스-로컬로 추적. Enter 가드에서 DOM 전역 조회 대신 사용
  // (전역 조회 시 다른 인스턴스의 팝업까지 잡혀 Enter 전송이 잘못 차단됨).
  const popupOpenRef = useRef(false);

  const editor = useEditor({
    autofocus: autoFocus,
    extensions: [
      Document,
      Paragraph,
      Text,
      Placeholder.configure({ placeholder }),
      // membersRef 는 suggestion items/render 콜백에서만 역참조된다. 이 콜백들은
      // 사용자가 '@' 를 입력할 때 ProseMirror 가 호출하며 렌더 시점에 동기 실행되지 않으므로
      // 안전하다 (react-hooks/refs 의 보수적 false positive).
      // eslint-disable-next-line react-hooks/refs
      Mention.configure({
        HTMLAttributes: { class: 'chat-mention' },
        renderText: ({ node }: { node: { attrs: Record<string, unknown> } }) =>
          `@${node.attrs.label as string}`,
        suggestion: {
          char: '@',
          items: ({ query }) => {
            const q = query.toLowerCase();
            return membersRef.current
              .filter(
                (m) =>
                  q === '' ||
                  m.name.toLowerCase().includes(q) ||
                  m.username.toLowerCase().includes(q),
              )
              .slice(0, 8);
          },
          render: () => {
            let component: ReactRenderer<MentionListHandle> | null = null;
            let popup: TippyInstance | null = null;
            return {
              onStart: (props: SuggestionProps<ChatMemberResponse>) => {
                popupOpenRef.current = true;
                component = new ReactRenderer(MentionList, {
                  props,
                  editor: props.editor,
                });
                popup = tippy(document.body, {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                });
              },
              onUpdate: (props: SuggestionProps<ChatMemberResponse>) => {
                component?.updateProps(props);
                popup?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === 'Escape') {
                  popup?.hide();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                popupOpenRef.current = false;
                popup?.destroy();
                component?.destroy();
                popup = null;
                component = null;
              },
            };
          },
        },
      }),
    ],
    content: initialBody ? bodyToDoc(initialBody, initialMentions) : undefined,
    editorProps: {
      attributes: {
        'data-testid': inputTestId,
        'aria-label': '채팅 메시지 작성',
        class:
          'min-h-[44px] max-h-40 overflow-auto rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      },
      handleKeyDown: (_view, event) => {
        // suggestion 팝업이 열려있으면 Enter 는 mention 플러그인이 먼저 처리(키 위임)하므로 여기선 무시.
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          // 이 인스턴스의 팝업이 열려있으면 mention 처리에 양보 (인스턴스-로컬 플래그).
          if (popupOpenRef.current) return false;
          event.preventDefault();
          submit();
          return true;
        }
        if (event.key === 'Escape' && onCancel) {
          event.preventDefault();
          onCancel();
          return true;
        }
        return false;
      },
    },
  });

  function submit() {
    if (!editor) return;
    const body = serializeToBody(editor.getJSON()).trim();
    if (body.length === 0) return;
    onSubmit(body);
    if (clearOnSubmit) {
      editor.commands.clearContent();
      editor.commands.focus();
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid={`${inputTestId}-wrap`}>
      <div className="relative">
        <EditorContent editor={editor} />
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            data-testid={cancelTestId}
          >
            취소
          </Button>
        )}
        <Button type="button" size="sm" onClick={submit} data-testid={submitTestId}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
