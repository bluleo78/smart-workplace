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
import { useEffect, useRef, useState } from 'react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';

import { Button } from '@/components/ui/button';

import { MentionList, type MentionListHandle } from './MentionList';
import { bodyToDoc, serializeToBody } from './mentionSerialize';
import type { MentionCandidate, MentionUser } from './types';

interface RichInputProps {
  members: MentionCandidate[];
  initialBody?: string;
  initialMentions?: MentionUser[];
  placeholder?: string;
  // void 면 즉시(다음 microtask) clear. Promise 를 반환하면 resolve(성공) 시에만 clear,
  // reject(전송 실패) 면 입력을 보존해 재시도 가능하게 한다(#123).
  onSubmit: (body: string) => void | Promise<unknown>;
  onCancel?: () => void;
  // 본문이 바뀔 때마다 호출 (타이핑 송신용). 제출/clear 도 onUpdate 를 트리거하나 호출처에서 throttle.
  onChange?: () => void;
  submitLabel?: string;
  clearOnSubmit?: boolean;
  // 본문이 비어도 제출 허용(첨부만 있는 메시지용). composer 가 pending 첨부 유무로 토글.
  allowEmptySubmit?: boolean;
  // true 일 때만 빈 입력에서 전송 버튼 비활성화(opt-in). 미전달 시 기존 동작 유지.
  disableWhenEmpty?: boolean;
  // 외부 상태(예: 파일 업로드 중)로 전송 버튼을 강제 비활성화. Enter 키 경로도 함께 차단.
  submitDisabled?: boolean;
  // 직렬화 본문(serializeToBody) 기준 최대 글자 수. 초과 시 전송 버튼 비활성화 + 카운터 빨간 표시.
  maxLength?: number;
  autoFocus?: boolean;
  inputTestId: string;
  submitTestId: string;
  cancelTestId?: string;
}

export function RichInput({
  members,
  initialBody = '',
  initialMentions = [],
  placeholder = '메시지 입력 (Shift+Enter 로 줄바꿈)',
  onSubmit,
  onCancel,
  onChange,
  submitLabel = '보내기',
  clearOnSubmit = false,
  allowEmptySubmit = false,
  disableWhenEmpty = false,
  submitDisabled = false,
  maxLength,
  autoFocus = false,
  inputTestId,
  submitTestId,
  cancelTestId,
}: RichInputProps) {
  // 에디터 본문 공백 여부 — disableWhenEmpty 가 true 일 때 전송 버튼 비활성화에 사용.
  // initialBody 가 있으면 비어있지 않은 상태로 초기화.
  const [isEmpty, setIsEmpty] = useState(!initialBody || initialBody.trim().length === 0);
  // maxLength 가 설정된 경우 실시간 글자 수 추적. 직렬화 본문 기준(serializeToBody)으로 서버 검증과 일치.
  const [charCount, setCharCount] = useState(initialBody ? initialBody.trim().length : 0);

  // members 최신값을 suggestion 콜백에서 참조하기 위한 ref.
  // (콜백은 useEditor 가 생성한 클로저에서 호출되므로, 렌더 시점이 아닌 effect 에서 최신값 동기화)
  const membersRef = useRef(members);
  useEffect(() => {
    membersRef.current = members;
  });

  // 멘션 팝업 활성 여부를 인스턴스-로컬로 추적. Enter 가드에서 DOM 전역 조회 대신 사용
  // (전역 조회 시 다른 인스턴스의 팝업까지 잡혀 Enter 전송이 잘못 차단됨).
  const popupOpenRef = useRef(false);

  // onChange 최신값을 onUpdate 콜백에서 참조 (membersRef 와 동일 패턴, 스테일 클로저 회피).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // onSubmit 최신값을 submit()(Enter 경로 포함)에서 참조. useEditor 는 1회 생성이라
  // handleKeyDown 이 첫 렌더 submit 클로저를 잡아 onSubmit 이 스테일해진다(예: composer 의
  // pending 첨부가 [] 로 고정 → Enter 전송 시 첨부 누락). ref 로 최신값 동기화.
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  });

  // allowEmptySubmit 최신값을 submit()(Enter 경로 포함)에서 참조. useEditor 는 1회 생성이라
  // handleKeyDown 이 첫 렌더 submit 클로저를 잡아 스테일해진다 — ref 로 최신값 동기화(위 패턴 동일).
  const allowEmptyRef = useRef(allowEmptySubmit);
  useEffect(() => {
    allowEmptyRef.current = allowEmptySubmit;
  });

  // submitDisabled 최신값을 submit()(Enter 경로 포함)에서 참조. 외부 비활성 상태(업로드 중 등)를
  // 버튼 클릭뿐 아니라 Enter 키 경로에서도 차단하기 위해 ref 로 동기화.
  const submitDisabledRef = useRef(submitDisabled);
  useEffect(() => {
    submitDisabledRef.current = submitDisabled;
  });

  // maxLength 최신값을 submit()(Enter 경로 포함)에서 참조. 버튼 disabled 와 Enter 경로 양쪽 차단.
  const maxLengthRef = useRef(maxLength);
  useEffect(() => {
    maxLengthRef.current = maxLength;
  });

  const editor = useEditor({
    autofocus: autoFocus,
    // 본문이 바뀔 때마다(타이핑) 호출. 호출처에서 throttle.
    // isEmpty 상태도 함께 갱신 — disableWhenEmpty 전송 버튼 비활성화에 사용.
    // charCount 도 갱신 — maxLength 초과 시 버튼 비활성화 및 카운터 표시에 사용.
    // serializeToBody 기준으로 서버 @Size(max) 검증과 동일한 길이를 측정한다.
    onUpdate: ({ editor }) => {
      setIsEmpty(editor.getText().trim().length === 0);
      setCharCount(serializeToBody(editor.getJSON()).trim().length);
      onChangeRef.current?.();
    },
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
              onStart: (props: SuggestionProps<MentionCandidate>) => {
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
              onUpdate: (props: SuggestionProps<MentionCandidate>) => {
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
    // 외부에서 전송을 차단한 경우(파일 업로드 중 등) 버튼·Enter 양쪽 모두 차단.
    if (submitDisabledRef.current) return;
    const body = serializeToBody(editor.getJSON()).trim();
    // 본문이 비어도 첨부가 있으면(allowEmptySubmit) 제출 허용.
    if (body.length === 0 && !allowEmptyRef.current) return;
    // maxLength 초과 시 버튼·Enter 양쪽 모두 차단(서버 @Size 검증과 동일 기준).
    if (maxLengthRef.current != null && body.length > maxLengthRef.current) return;
    // 변경 없는 저장은 no-op — onCancel 로 닫아 불필요한 update 호출을 막는다 (#44).
    // composer 는 initialBody='' + body 비어있지 않음이라 절대 매칭되지 않는다.
    if (body === initialBody.trim() && onCancel) {
      onCancel();
      return;
    }
    const result = onSubmitRef.current(body);
    if (clearOnSubmit) {
      // 성공 시에만 입력창을 비운다(#123). onSubmit 이 전송 mutation Promise 를 반환하면
      // resolve(성공) 후 clear, reject(전송 실패) 면 입력을 보존해 즉시 재시도할 수 있게 한다.
      // void 반환(첨부 attach 등 비-Promise 경로)이면 resolve 로 취급해 기존처럼 비운다.
      Promise.resolve(result).then(
        () => {
          // 비동기 resolve 시점에 언마운트됐을 수 있으므로 editor 파괴 여부를 확인.
          if (editor.isDestroyed) return;
          // clearContent(emitUpdate=true) — TipTap 2.27.2 의 clearContent 기본값(false)은
          // onUpdate 를 발생시키지 않아, 전송 직후 isEmpty/charCount 가 stale(false/직전값)로 남는다.
          // 그 결과 disableWhenEmpty 컴포저(이슈 챗 ChatComposer 등)에서 전송 후 빈 입력인데도
          // 보내기 버튼이 활성으로 남아 클릭 시 silent no-op 이 되는 회귀(#197)가 발생.
          // true 를 전달해 update 를 강제 → onUpdate(line 126)가 isEmpty=true / charCount=0 을 동기화.
          editor.commands.clearContent(true);
          editor.commands.focus();
        },
        () => {
          // 전송 실패: 입력 유지. 포커스만 복귀시켜 재시도 가능하게.
          if (editor.isDestroyed) return;
          editor.commands.focus();
        },
      );
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid={`${inputTestId}-wrap`}>
      <div className="relative">
        <EditorContent editor={editor} />
      </div>
      <div className="flex items-center justify-end gap-2">
        {/* maxLength 설정 시 글자 수 카운터 표시. charCount > 0 일 때만 노출해 빈 입력 노이즈 방지. */}
        {/* 초과 시 text-destructive(빨간색)로 강조. */}
        {maxLength != null && charCount > 0 && (
          <span
            className={`text-xs tabular-nums ${charCount > maxLength ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
            data-testid="char-count"
          >
            {charCount} / {maxLength}
          </span>
        )}
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
        {/* disableWhenEmpty=true 이고 본문도 비고 첨부도 없을 때만 비활성화(opt-in). */}
        {/* allowEmptySubmit 은 렌더 시점 prop 직접 참조 — ref 는 submit(Enter 경로) 전용. */}
        {/* submitDisabled 는 외부 상태(업로드 중 등)로 강제 비활성화. 버튼·Enter 양쪽 차단. */}
        {/* maxLength 초과 시도 비활성화 — charCount 와 동일 기준(렌더 시점 prop 직접 참조). */}
        <Button
          type="button"
          size="sm"
          onClick={submit}
          data-testid={submitTestId}
          disabled={
            submitDisabled ||
            (disableWhenEmpty ? isEmpty && !allowEmptySubmit : false) ||
            (maxLength != null && charCount > maxLength)
          }
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
