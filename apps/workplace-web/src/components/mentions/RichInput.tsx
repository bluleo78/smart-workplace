// TipTap 기반 chat 입력 공용 컴포넌트 (composer/editor 공용).
// mention 칩 + @ suggestion. Enter=onSubmit(모바일 터치 셸은 줄바꿈 — lib/submitEnter), Shift+Enter=줄바꿈, Esc=onCancel.
// IME(한글 조합)는 ProseMirror 가 처리. 전송 후 clearOnSubmit 이면 비우고 포커스 유지.

import './chat-rich-input.css';

import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Mention from '@tiptap/extension-mention';
import Paragraph from '@tiptap/extension-paragraph';
import Placeholder from '@tiptap/extension-placeholder';
import Text from '@tiptap/extension-text';
import { EditorContent, ReactRenderer, useEditor } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { ArrowUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';

import { Button } from '@/components/ui/button';
import { filesFromPaste, isFileDrag } from '@/lib/clipboardFiles';
import { flushBeforeImeEnter } from '@/lib/imeEnterFlush';
import { keepFocusProps } from '@/lib/keepFocus';
import { isSubmitEnter } from '@/lib/submitEnter';

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
  // 버튼 행 좌측에 추가로 렌더할 노드(파일 첨부 버튼 등). 미전달 시 우측 버튼만 노출. inlineSubmit 이면 에디터 왼쪽.
  leftActions?: React.ReactNode;
  /** 파일 첨부를 받는 입력창(WP-235). 전달하면 두 가지가 바뀐다:
   *  ① 클립보드 파일(스크린샷 등) 붙여넣기를 본문 대신 여기로 넘긴다(텍스트가 함께 오면 텍스트 우선, lib/clipboardFiles).
   *  ② 에디터 위 파일 드롭은 ProseMirror 기본 처리를 막고 버블링만 시킨다 — 업로드는 호출처 래퍼의 useComposerFileDrop 이 받는다. */
  onFiles?: (files: File[]) => void;
  inputTestId: string;
  submitTestId: string;
  cancelTestId?: string;
  /** 에디터 최대 높이 클래스 — 넘치면 내부 스크롤. 모바일 하단 코멘트는 정확히 4줄(max-h-[calc(4lh+1rem+2px)]). 기본 max-h-40.
   *  에디터 class 는 useEditor 생성 시 1회만 적용되므로 마운트 후 동적 변경은 지원하지 않는다.
   *  Tailwind 가 클래스를 생성하도록 호출부에 리터럴로 쓴다. */
  editorMaxHeightClass?: string;
  /** 한 줄 레이아웃: [leftActions] [에디터] [전송] — 2단(에디터+버튼 행)은 하단 고정 줄이 화면을 너무 차지했다(WP-196 모바일 코멘트,
   *  WP-235 채팅 입력창). 여러 줄이면 에디터만 위로 늘고 양옆 버튼은 하단 정렬. 전송은 모바일 44px 아이콘 / 데스크톱 텍스트 버튼.
   *  글자 수 카운터는 한도 80% 를 넘을 때만 노출. onCancel 은 렌더하지 않는다.
   *  전송 탭이 에디터를 blur 하면 iOS 키보드가 내려가고 전송 후 비동기 focus 로는 다시 안 올라오므로(사용자 제스처 밖)
   *  전송 버튼은 포커스를 빼앗지 않는다(keepFocusProps — 기본 레이아웃 전송 버튼도 같다, WP-224). 기본 false. */
  inlineSubmit?: boolean;
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
  leftActions,
  inputTestId,
  submitTestId,
  cancelTestId,
  editorMaxHeightClass = 'max-h-40',
  inlineSubmit = false,
  onFiles,
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

  // onFiles 최신값을 handlePaste/handleDrop(useEditor 1회 생성 클로저)에서 참조 — 위 ref 패턴 동일.
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });

  // 동기적 in-flight 가드(#586) — ref 는 즉시(리렌더 없이) 반영되므로 같은 이벤트 루프 틱
  // 내에 버튼이 여러 번 클릭되거나 Enter+클릭이 겹쳐도(pending prop 갱신 전) 두 번째 이후
  // 호출을 차단한다. WikiCreateSpaceDialog(#581)와 동일 패턴 — RichInput 은 여러 소비처
  // (MessageComposer/ChatComposer/ChatMessageEditor 등)가 공유하므로 이 chokepoint 하나로
  // 전체가 해결된다. state(submitting)는 버튼의 시각적 disabled 표시용 보조 상태.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  // leftActions: 버튼 행 좌측에 렌더할 커스텀 액션(파일 첨부 버튼 등). 미전달 시 좌측 영역 빈 채로 유지.
  // (RichInput 내부 버튼 행을 justify-between 구조로 확장해 composer 와 editor 간 레이아웃 통합)

  const editor = useEditor({
    // 자동 포커스는 본문 끝에 둔다 — 기존 메시지·코멘트 수정은 이어 쓰기가 자연스럽고, 빈 컴포저(이슈 채팅 드로워)는 끝=처음이다.
    // true(=start)는 마운트 직후 비동기로 커서를 맨 앞으로 옮겨, 그 사이 사용자가 끝으로 옮긴 커서를 되돌렸다(WP-85 flaky).
    autofocus: autoFocus ? 'end' : false,
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
      // Shift+Enter 줄바꿈(<br>) 처리. StarterKit 포함 패키지이므로 별도 설치 불필요.
      HardBreak,
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
                // 모달 드로어(Sheet=role="dialog") 안에서는 body 로 portal 된 팝업이
                // Radix 의 pointer-events:none 로 클릭 투과돼 옵션 선택이 막힌다(#558 채팅 드로워).
                // 에디터가 dialog 안이면 그 dialog 에 append 해 인터랙티브 영역 안에 둔다(밖이면 body).
                const editorDom = props.editor.view.dom as HTMLElement;
                const dialog = editorDom.closest<HTMLElement>('[role="dialog"]');
                popup = tippy(document.body, {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => dialog ?? document.body,
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
        // 한 줄 레이아웃 데스크톱은 36px(＋·보내기 버튼과 같은 높이), 그 밖은 44px 터치 타깃.
        // 모바일 한 줄은 원형 ＋·보내기와 어울리게 둥근 모서리(메인 AI 채팅 모바일 입력과 같은 rounded-2xl).
        class: `${inlineSubmit ? 'min-h-11 max-lg:rounded-2xl lg:min-h-9 lg:py-1.5' : 'min-h-[44px]'} ${editorMaxHeightClass} overflow-auto rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`,
      },
      // 클립보드 파일(스크린샷 등)은 본문에 넣지 않고 첨부로 넘긴다. 텍스트가 함께 있으면 텍스트 붙여넣기(filesFromPaste).
      handlePaste: (_view, event) => {
        const handler = onFilesRef.current;
        if (!handler) return false;
        const files = filesFromPaste(event.clipboardData);
        if (files.length === 0) return false;
        handler(files);
        return true;
      },
      // 파일 드롭은 ProseMirror 가 처리하지 않게만 막는다(true → preventDefault). 이벤트는 래퍼로 버블링돼
      // useComposerFileDrop 이 업로드한다 — 에디터 밖(칩 영역 등) 드롭과 한 경로로 처리하려고.
      handleDrop: (_view, event) => !!onFilesRef.current && isFileDrag(event.dataTransfer),
      handleKeyDown: (view, event) => {
        // macOS Chrome 은 한글 조합을 끝내는 Enter 를 확정 글자가 문서에 반영되기 전에 보낸다(WP-333) — 전송·멘션 선택이
        // 마지막 글자 없는 본문을 읽지 않게 먼저 반영한다. editorProps 는 플러그인보다 먼저 돌아 확장으로는 늦다.
        flushBeforeImeEnter(view, event);
        // suggestion 팝업이 열려있으면 Enter 는 mention 플러그인이 먼저 처리(키 위임)하므로 여기선 무시.
        if (isSubmitEnter(event)) {
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
    // 인플라이트 가드(#586) — 이미 전송 중이면 재호출 무시. 버튼 onClick·Enter 키 두 경로가
    // 모두 이 함수를 거치므로 여기 하나로 양쪽 다 차단된다.
    if (submittingRef.current) return;
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
    submittingRef.current = true;
    setSubmitting(true);
    const result = onSubmitRef.current(body);
    // onSubmit 이 void 를 반환해도 Promise.resolve 가 즉시 resolve 된 Promise 로 감싸므로
    // 아래 release 는 항상 마이크로태스크에서 실행된다 — 동일 이벤트 루프 틱 내 동기적으로
    // 발생하는 추가 클릭은 그 전에 이미 위 가드에서 차단됨(WikiCreateSpaceDialog#581과 동일 원리).
    const release = () => {
      submittingRef.current = false;
      setSubmitting(false);
    };
    Promise.resolve(result).then(release, release);
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

  // 전송 버튼 비활성 조건 — 두 레이아웃(기본·inlineSubmit)이 공유.
  // disableWhenEmpty=true 이고 본문도 비고 첨부도 없을 때만 비활성화(opt-in). allowEmptySubmit 은 렌더 시점 prop 직접 참조 — ref 는 submit(Enter 경로) 전용.
  // submitDisabled 는 외부 상태(업로드 중 등)로 강제 비활성화. maxLength 초과 시도 비활성화 — charCount 와 동일 기준.
  // submitting 은 인플라이트 가드(#586)의 시각적 반영 — 실제 중복 제출 차단은 submittingRef 가 담당.
  const submitBlocked =
    submitDisabled ||
    submitting ||
    (disableWhenEmpty ? isEmpty && !allowEmptySubmit : false) ||
    (maxLength != null && charCount > maxLength);

  if (inlineSubmit) {
    // 한 줄 레이아웃 [leftActions] [에디터] [전송] — 에디터만 min-w-0 flex-1 로 늘고(좁은 폭에서 TipTap 이 넘치지 않게) 양옆은 하단 정렬.
    // 카운터는 한도 80% 초과 시에만 — 평소엔 하단 줄 높이를 늘리지 않는다.
    const showCount = maxLength != null && charCount > maxLength * 0.8;
    return (
      <div className="flex flex-col gap-1" data-testid={`${inputTestId}-wrap`}>
        <div className="flex flex-row items-end gap-2">
          {leftActions && <div className="flex shrink-0 items-center">{leftActions}</div>}
          <div className="relative min-w-0 flex-1">
            <EditorContent editor={editor} />
          </div>
          {/* 전송: 모바일은 44px 원형 아이콘(메인 AI 채팅 모바일 전송과 같은 메신저 관례), 데스크톱은 텍스트 버튼(에디터 한 줄 36px 와 같은 높이).
              에디터처럼 CSS 브레이크포인트로만 바꾼다 — 라벨이 '업로드 중…' 으로 바뀌면 데스크톱엔 글자로, 모바일엔 접근 이름으로 전달. */}
          <Button
            type="button"
            className="shrink-0 max-lg:size-11 max-lg:rounded-full max-lg:p-0"
            aria-label={submitLabel}
            onClick={submit}
            {...keepFocusProps}
            data-testid={submitTestId}
            disabled={submitBlocked}
          >
            <ArrowUp className="size-5 lg:hidden" aria-hidden />
            <span className="max-lg:hidden">{submitLabel}</span>
          </Button>
        </div>
        {showCount && (
          <span
            className={`self-end text-xs tabular-nums ${charCount > maxLength ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
            data-testid="char-count"
          >
            {charCount} / {maxLength}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid={`${inputTestId}-wrap`}>
      <div className="relative">
        <EditorContent editor={editor} />
      </div>
      {/* leftActions 가 있으면 justify-between 으로 좌우 분리, 없으면 justify-end 로 우측 정렬. */}
      <div className={`flex items-center gap-2 ${leftActions ? 'justify-between' : 'justify-end'}`}>
        {leftActions && <div className="flex items-center gap-1">{leftActions}</div>}
        <div className="flex items-center gap-2">
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
          {/* 전송 탭이 에디터를 blur 하지 않게(keepFocusProps) — 채팅 컴포저에서 보낼 때마다 iOS 키보드가 내려갔다 올라오지 않게(WP-224). */}
          <Button
            type="button"
            size="sm"
            className="max-lg:h-11"
            onClick={submit}
            {...keepFocusProps}
            data-testid={submitTestId}
            disabled={submitBlocked}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
