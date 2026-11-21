// TipTap 기반 chat 입력 공용 컴포넌트 (composer/editor 공용).
// mention 칩 + @ suggestion. Enter=onSubmit(모바일 터치 셸은 줄바꿈 — lib/submitEnter), Shift+Enter=줄바꿈, Esc=onCancel.
// IME(한글 조합)는 ProseMirror 가 처리. 전송 후 clearOnSubmit 이면 비우고 포커스 유지.
// formatting(WP-101, 팀 채팅·이슈 채팅만)이면 서식(굵게·목록·코드 등) 확장과 「Aa」 서식 도구 줄을 더하고 본문을 채팅 마크다운으로 주고받는다.
// bodyMode(WP-1656, 이슈 본문 편집칸)면 편집칸만 그리고 원문을 한 바이트도 바꾸지 않는다 — Enter=줄바꿈, Cmd/Ctrl+Enter=onSubmit(다듬지 않은 원문),
// 붙여넣기·복사는 줄 단위 그대로(bodyModeClipboard), 이미지는 보기 화면 크기, 실행 취소(bodyHistory). 저장·취소 판단은 바깥이 한다.

import './chat-rich-input.css';

import type { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Mention from '@tiptap/extension-mention';
import Paragraph from '@tiptap/extension-paragraph';
import Placeholder from '@tiptap/extension-placeholder';
import Text from '@tiptap/extension-text';
import { isHistoryTransaction } from '@tiptap/pm/history';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorContent, ReactRenderer, useEditor } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { ArrowUp, Loader2 } from 'lucide-react';
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { toast } from 'sonner';
import tippy, { type Instance as TippyInstance } from 'tippy.js';

import { IssueBodyImageButton } from '@/components/issue/IssueBodyImageButton';
import { Button } from '@/components/ui/button';
import { usePersistentToggle } from '@/hooks/usePersistentToggle';
import { extractApiError } from '@/lib/api-error';
import { filesFromPaste, isFileDrag } from '@/lib/clipboardFiles';
import { INVALID_IMAGE_MSG, isValidImageFile } from '@/lib/imageUpload';
import { ImeCommitFlush } from '@/lib/imeCommitFlush';
import { isImeComposing } from '@/lib/imeKey';
import { keepFocusProps } from '@/lib/keepFocus';
import { isSubmitEnter, SHIFT_ENTER_HINT } from '@/lib/submitEnter';

import { BodyHistory } from './bodyHistory';
import { bodyTextToSlice, sliceToBodyText } from './bodyModeClipboard';
import { chatFormattingExtensions } from './chatFormatting';
import { ChatFormatToggle, ChatFormatToolbar } from './ChatFormatToolbar';
import { MentionList, type MentionListHandle } from './MentionList';
import { bodyToDoc, serializeToBody } from './mentionSerialize';
import {
  createRichBodyImage,
  hasImage,
  hasPendingImage,
  insertBodyImagePlaceholders,
  insertImagePlaceholders,
  RichImage,
  settleBodyImage,
  settlePendingImage,
} from './richImageNode';
import { sentPrefixEnd } from './sentPrefix';
import { type MentionCandidate, type MentionUser, toMentionUser } from './types';
import { waitCompositionIdle } from './waitCompositionIdle';

interface RichInputProps {
  members: MentionCandidate[];
  /** 입력칸의 접근성 이름 — 스크린리더가 읽는 이름이라 쓰는 곳에 맞게 넘긴다(예: 「코멘트 작성」·「메시지 수정」).
   *  채팅·코멘트가 함께 쓰는 공용 입력창이라 고정 이름(「채팅 메시지 작성」)을 두면 코멘트·수정칸도 채팅 작성칸으로 읽혔다(WP-831).
   *  에디터 속성은 생성 시 1회 적용되므로 마운트 후 바꿔도 반영되지 않는다. */
  ariaLabel: string;
  initialBody?: string;
  initialMentions?: MentionUser[];
  placeholder?: string;
  // void 면 즉시(다음 microtask) clear. Promise 를 반환하면 resolve(성공) 시에만 clear,
  // reject(전송 실패) 면 입력을 보존해 재시도 가능하게 한다(#123).
  onSubmit: (body: string) => void | Promise<unknown>;
  onCancel?: () => void;
  // 본문이 바뀔 때마다 호출 (타이핑 송신용). 제출/clear 도 onUpdate 를 트리거하나 호출처에서 throttle.
  // 인자 state.isEmpty 는 바뀐 뒤 입력칸이 비었는지(WP-1923 — 전송 중 이어 쓴 글자가 남는지 호출처가 알 수 있게).
  onChange?: (state: { isEmpty: boolean }) => void;
  submitLabel?: string;
  clearOnSubmit?: boolean;
  // 본문이 비어도 제출 허용(첨부만 있는 메시지용). composer 가 pending 첨부 유무로 토글.
  allowEmptySubmit?: boolean;
  // true 일 때만 빈 입력에서 전송 버튼 비활성화(opt-in). 미전달 시 기존 동작 유지.
  disableWhenEmpty?: boolean;
  // 본문 밖에 바뀐 것이 있음(WP-1679, 메시지 수정에서 첨부를 뺌) — true 면 본문이 처음과 같아도 「변경 없음 → onCancel」로 닫지 않고 onSubmit 한다.
  changedOutsideBody?: boolean;
  // 외부 상태(예: 파일 업로드 중)로 전송 버튼을 강제 비활성화. Enter 키 경로도 함께 차단.
  submitDisabled?: boolean;
  // 직렬화 본문(serializeToBody) 기준 최대 글자 수. 초과 시 전송 버튼 비활성화 + 카운터 빨간 표시.
  maxLength?: number;
  // maxLength 초과 시 입력창 아래에 role=alert 로 보일 안내 문구(현재 글자 수를 받는다). 입력은 자르지 않고(붙여넣기 유실 방지) 전송만 막는다.
  // 미전달이면 카운터(빨간 N / max)만 보인다.
  overLimitMessage?: (count: number) => string;
  autoFocus?: boolean;
  /** 포커스 요청 번호(WP-1372) — 0 보다 크면 본문 끝에 포커스하고 onFocusRequestDone 을 부른다. 에디터가 아직 만들어지기 전이면 만들어진 뒤 한다.
   *  한 번만 쓰는 요청이다 — 호출처는 onFocusRequestDone 에서 0 으로 돌려, 입력창이 나중에 다시 만들어져도(포털 대상 교체·쓰기 권한 바뀜) 포커스를
   *  다시 가져가지 않게 한다. autoFocus 와 달리 마운트 뒤에도 새 번호로 다시 요청할 수 있다(개인 작업 상세의 채팅 버튼).
   *  스크롤은 호출처가 맞추므로 포커스가 스크롤하지 않는다. */
  focusRequest?: number;
  onFocusRequestDone?: () => void;
  // 버튼 행 좌측에 추가로 렌더할 노드(파일 첨부 버튼 등). 미전달 시 우측 버튼만 노출. inlineSubmit 이면 에디터 왼쪽.
  leftActions?: React.ReactNode;
  /** 파일 첨부를 받는 입력창(WP-235). 전달하면 두 가지가 바뀐다:
   *  ① 클립보드 파일(스크린샷 등) 붙여넣기를 본문 대신 여기로 넘긴다(텍스트가 함께 오면 텍스트 우선, lib/clipboardFiles).
   *  ② 에디터 위 파일 드롭은 ProseMirror 기본 처리를 막고 버블링만 시킨다 — 업로드는 호출처 래퍼의 useComposerFileDrop 이 받는다. */
  onFiles?: (files: File[]) => void;
  /** 입력창 안 이미지(WP-362, 이슈 코멘트). 전달하면 붙여넣기·드롭·이미지 버튼으로 넣은 이미지가 커서 자리에 썸네일로 들어가고,
   *  이 함수로 올린 결과(url·이름)를 본문에 `![이름](url)` 로 저장한다. 업로드 중엔 전송이 막힌다. 마운트 시점 기준(에디터 스키마가 1회 생성). */
  imageUpload?: (file: File) => Promise<{ url: string; name: string }>;
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
  /** 서식 입력(WP-101) — 팀 채팅·이슈 채팅의 작성·수정칸만 켠다(이슈 코멘트 등은 끈 채 그대로). 켜면:
   *  ① 굵게·기울임·밑줄·취소선·코드·코드 블록·목록·링크 확장 + 단축키·마크다운 입력 규칙(chatFormatting)
   *  ② 왼쪽 「Aa」 토글로 여닫는 서식 도구 줄(열림 상태는 기기별로 기억) — 한 줄 레이아웃은 입력 줄 위, 기본 레이아웃은 에디터 위
   *  ③ 본문을 채팅 마크다운으로 직렬화·복원(mentionSerialize). 에디터 스키마가 1회 생성되므로 마운트 시점 값으로 고정. */
  formatting?: boolean;
  /** 본문 모드(WP-1656) — 이슈 본문 편집칸. 마운트 시점 값으로 고정(에디터 스키마가 1회 생성). 켜면:
   *  ① 편집칸만 그린다(버튼 줄·전송·글자 수·서식 도구·이미지 버튼 없음 — 바깥 InlineEditableBody 가 맡는다)
   *  ② 원문 ↔ 문서는 줄 = 문단 그대로이고 projectKey 의 이슈 이미지만 노드(보기 화면 크기) — 다른 프로젝트·외부 이미지는 글자
   *  ③ Enter=줄바꿈, Cmd/Ctrl+Enter=onSubmit(지금 원문 — trim·변경 없음 비교·비우기 없이 바깥이 판단, 업로드 중엔 부르지 않음), Esc=onCancel
   *  ④ 붙여넣기는 일반 글자를 줄 단위 그대로(HTML 이 함께 와도 서식 없이), 복사는 문단 사이 줄바꿈 하나, 실행 취소 기록
   *  ⑤ frame — 'boxed'(생략·기본)는 테두리·안쪽 여백이 있는 지금 모양, 'bare' 는 테두리·배경·안쪽 여백·포커스 링 없이 글자만
   *     (모바일 이슈 만들기 시트처럼 바깥이 이미 칸을 그려 둔 곳). 마운트 때 한 번만 읽는다(bodySetup).
   *  이미지 업로드는 imageUpload 로 한다(본문 모드에서 필요). */
  bodyMode?: { projectKey: string; frame?: 'boxed' | 'bare' };
  /** 본문 모드 — 내용이 바뀔 때마다 다듬지 않은 원문(serializeToBody). 바깥 draft 를 이것으로 맞춘다. */
  onBodyChange?: (body: string) => void;
  /** 본문 모드 — 업로드 중 이미지(자리표시)가 있는지가 바뀔 때. 바깥이 저장 버튼·단축키·모바일 바를 막는 데 쓴다. */
  onUploadingChange?: (uploading: boolean) => void;
  /** 편집칸(contenteditable) 접근성 상태 — 바깥이 판단한 상태를 입력칸 자체에 단다(본문 모드 InlineEditableBody: 5만 자 초과·권한 없음).
   *  invalid → aria-invalid="true", describedBy → aria-describedby(안내 문구 id), disabled → aria-disabled="true". 바뀌면 바로 반영된다. */
  editorAria?: { invalid?: boolean; describedBy?: string; disabled?: boolean };
  /** 바깥 조작 핸들 — 본문 모드 바깥의 「이미지」 버튼이 커서 자리에 이미지를 넣는다(insertImages). */
  ref?: Ref<RichInputHandle>;
}

/**
 * 입력칸이 비었는지 — 공백·줄바꿈뿐이어도 비었다고 보고, 글 없이 이미지만 있으면 비어 있지 않다(WP-362).
 * 키 입력마다 호출되므로 editor.isEmpty(O(1))로 먼저 거르고, 아니면 글자·멘션을 처음 찾는 즉시 멈추는 탐색을 쓴다
 * (getText 로 문서 전체를 이어 붙이지 않는다). 결과는 `getText().trim() === '' && 이미지 없음` 과 같다.
 */
function isEditorBlank(editor: Editor, imagesEnabled: boolean): boolean {
  if (editor.isEmpty) return true;
  let found = false;
  editor.state.doc.descendants((node) => {
    if (found) return false;
    if ((node.isText && (node.text ?? '').trim().length > 0) || node.type.name === 'mention') found = true;
    return !found;
  });
  return !found && !(imagesEnabled && hasImage(editor));
}

/** editorAria → 편집칸 속성. 값이 없는 속성은 넣지 않는다(ProseMirror 는 undefined 도 "undefined" 글자로 단다). */
function editorAriaAttributes(aria: RichInputProps['editorAria']): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (aria?.invalid) attrs['aria-invalid'] = 'true';
  if (aria?.describedBy) attrs['aria-describedby'] = aria.describedBy;
  if (aria?.disabled) attrs['aria-disabled'] = 'true';
  return attrs;
}

/** RichInput 바깥 조작 핸들(ref). */
export interface RichInputHandle {
  /** 이미지 파일을 현재 커서 자리에 넣고 업로드한다(자리표시 → 이미지). 형식·크기가 틀린 파일은 걸러 한 번 안내한다. */
  insertImages: (files: File[]) => void;
  /** 편집칸 끝(본문 끝)으로 포커스를 옮긴다 — 폼 검사 실패 때 바깥이 오류 난 본문 칸으로 포커스를 보내는 데 쓴다. */
  focus: () => void;
  /**
   * 지금 본문의 멘션 이름표(id → 이름·종류) — 칸을 다시 마운트할 때(WP-1768 새 이슈 창의 프로젝트 바꾸기) 새 칸의 initialMentions 로 넘겨
   * <@id> 칩이 「알 수 없음」이 되지 않게 한다. 처음 멘션·지금 후보가 아는 이름을 먼저 쓰고, 모르는 id 는 칩에 보이는 이름으로 채운다.
   */
  mentionUsers: () => MentionUser[];
}

/** 서식 도구 줄 열림 상태 저장 키 — 채팅 입력창 전체가 하나를 공유한다(한 번 열어 두면 어느 채팅에서나 열려 있게). */
const FORMAT_TOOLBAR_KEY = 'chat-format-toolbar-open';

export function RichInput({
  members,
  ariaLabel,
  initialBody = '',
  initialMentions = [],
  placeholder = `메시지 입력${SHIFT_ENTER_HINT}`,
  onSubmit,
  onCancel,
  onChange,
  submitLabel = '보내기',
  clearOnSubmit = false,
  allowEmptySubmit = false,
  disableWhenEmpty = false,
  changedOutsideBody = false,
  submitDisabled = false,
  maxLength,
  overLimitMessage,
  autoFocus = false,
  focusRequest = 0,
  onFocusRequestDone,
  leftActions,
  inputTestId,
  submitTestId,
  cancelTestId,
  editorMaxHeightClass = 'max-h-40',
  inlineSubmit = false,
  onFiles,
  imageUpload,
  formatting = false,
  bodyMode,
  onBodyChange,
  onUploadingChange,
  editorAria,
  ref,
}: RichInputProps) {
  // 에디터 본문 공백 여부 — disableWhenEmpty 가 true 일 때 전송 버튼 비활성화에 사용.
  // initialBody 가 있으면 비어있지 않은 상태로 초기화.
  const [isEmpty, setIsEmpty] = useState(!initialBody || initialBody.trim().length === 0);
  // 업로드 중 이미지가 남아 있는지 — 전송 버튼 표시용(WP-362). Enter 경로는 submit 이 문서를 직접 본다.
  const [imageUploading, setImageUploading] = useState(false);
  // maxLength 가 설정된 경우 실시간 글자 수 추적. 직렬화 본문 기준(serializeToBody)으로 서버 검증과 일치.
  const [charCount, setCharCount] = useState(initialBody ? initialBody.trim().length : 0);

  // members 최신값을 suggestion 콜백에서 참조하기 위한 ref.
  // (콜백은 useEditor 가 생성한 클로저에서 호출되므로, 렌더 시점이 아닌 effect 에서 최신값 동기화)
  const membersRef = useRef(members);
  useEffect(() => {
    membersRef.current = members;
  });

  // 안내 문구는 에디터를 만들 때 한 번만 읽히므로, ref 로 최신 값을 읽게 하고 바뀌면 빈 트랜잭션으로 장식을 다시 그린다
  // (담당 AI 가 바뀌면 이슈 챗 작성창 안내가 새로고침 없이 바뀐다, WP-373).
  const placeholderRef = useRef(placeholder);
  useEffect(() => {
    placeholderRef.current = placeholder;
  }, [placeholder]);

  // 멘션 팝업 활성 여부를 인스턴스-로컬로 추적. Enter 가드에서 DOM 전역 조회 대신 사용
  // (전역 조회 시 다른 인스턴스의 팝업까지 잡혀 Enter 전송이 잘못 차단됨).
  const popupOpenRef = useRef(false);
  // 본문 모드 멘션 팝업 — live: 고를 후보가 보이는가(맞는 멤버가 있고 Esc 로 닫지 않음), dismissed: 이번 자동완성에서 Esc 로 닫았는가
  // (닫은 뒤엔 다시 열지 않는다 — 코멘트의 popup.hide 와 같다), hide: 지금 팝업 숨기기(팝업이 없으면 null).
  // 본문에는 @Override·@media 처럼 멤버가 아닌 @단어가 흔한데 그때도 자동완성은 켜져 있어(빈 팝업은 그려지지 않음), 키를 팝업에 넘기면
  // Enter·Esc 가 아무 일도 하지 않았다 — 후보가 보일 때만 키를 팝업에 넘긴다. 코멘트·채팅은 popupOpenRef·popup.hide 를 그대로 쓴다.
  const bodyPopupRef = useRef<{ live: boolean; dismissed: boolean; hide: (() => void) | null }>({
    live: false,
    dismissed: false,
    hide: null,
  });

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

  // changedOutsideBody 최신값도 submit()(Enter 경로 포함)에서 참조 — 위 패턴 동일.
  const changedOutsideBodyRef = useRef(changedOutsideBody);
  useEffect(() => {
    changedOutsideBodyRef.current = changedOutsideBody;
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

  // onBodyChange·onUploadingChange 최신값을 onUpdate(useEditor 1회 생성 클로저)에서 참조 — 위 ref 패턴 동일.
  const onBodyChangeRef = useRef(onBodyChange);
  const onUploadingChangeRef = useRef(onUploadingChange);
  useEffect(() => {
    onBodyChangeRef.current = onBodyChange;
    onUploadingChangeRef.current = onUploadingChange;
  });
  // 바깥에 마지막으로 알린 업로드 중 여부 — 바뀔 때만 onUploadingChange 를 부른다(타이핑마다 부르지 않게).
  const uploadingNotifiedRef = useRef(false);
  // 바깥에 마지막으로 알린 원문 — 같으면 onBodyChange 를 다시 부르지 않는다(자리표시 넣기처럼 원문이 그대로인 변경에 바깥을 다시 그리지 않게).
  const lastBodyRef = useRef<string | null>(null);

  // 본문 모드(WP-1656)도 스키마·키 처리가 에디터 생성 시 정해지므로 마운트 시점 값으로 고정한다. image 는 이 프로젝트 경로만 받고
  // 보기 화면 크기로 그리는 이미지 확장 — 렌더마다 새로 만들지 않게 한 번만. 본문 모드 여부는 모두 이것 하나로 가른다.
  const [bodySetup] = useState(() =>
    bodyMode
      ? { projectKey: bodyMode.projectKey, bare: bodyMode.frame === 'bare', image: createRichBodyImage(bodyMode.projectKey) }
      : null,
  );
  const bodyModeEnabled = bodySetup != null;
  // 이미지 스키마는 에디터 생성 시 1회만 정해진다 — 마운트 시점 값으로 고정. 업로드 함수는 insertImages 가 매 렌더 최신 prop 을 읽는다.
  // 본문 모드는 원문의 이미지 줄을 그려야 하므로 늘 켠다.
  const [imagesEnabled] = useState(() => imageUpload != null || bodyMode != null);
  // 서식 스키마도 마찬가지로 마운트 시점 값으로 고정(WP-101). 본문 모드는 원문을 그대로 지켜야 하므로 서식을 쓰지 않는다.
  const [formattingEnabled] = useState(formatting && bodyMode == null);
  const [toolbarOpen, toggleToolbar] = usePersistentToggle(FORMAT_TOOLBAR_KEY, false);
  // 「변경 없는 저장」 비교 기준 — 서식 입력창은 예전 본문이 직렬화로 모양만 바뀔 수 있어(`* a` → `- a`) 한 번 읽고 쓴 모양과 비교한다.
  // 그래야 손대지 않은 예전 메시지를 저장해도 (수정됨) 이 붙지 않는다.
  const [initialCompare] = useState(() =>
    formatting && initialBody
      ? serializeToBody(bodyToDoc(initialBody, initialMentions, { formatting: true })).trim()
      : initialBody.trim(),
  );
  // 자리표시 노드 식별자 순번 — 인스턴스마다 독립.
  const uploadSeq = useRef(0);
  // handlePaste/handleDrop(useEditor 1회 생성 클로저)이 최신 insertImages 를 부르도록 — 위 ref 패턴 동일.
  const insertImagesRef = useRef<(files: File[], at?: number) => void>(() => {});
  // 끝난 업로드의 결과(실패면 null, 본문 모드만) — 실행 취소가 지웠던 자리표시를 되살리면 이것으로 다시 채운다(영영 「업로드 중」이 되지 않게).
  const settledUploads = useRef(new Map<string, { src: string; alt: string } | null>());

  // 동기적 in-flight 가드(#586) — ref 는 즉시(리렌더 없이) 반영되므로 같은 이벤트 루프 틱
  // 내에 버튼이 여러 번 클릭되거나 Enter+클릭이 겹쳐도(pending prop 갱신 전) 두 번째 이후
  // 호출을 차단한다. WikiCreateSpaceDialog(#581)와 동일 패턴 — RichInput 은 여러 소비처
  // (MessageComposer/ChatComposer/ChatMessageEditor 등)가 공유하므로 이 chokepoint 하나로
  // 전체가 해결된다. state(submitting)는 버튼의 시각적 disabled 표시용 보조 상태.
  const submittingRef = useRef(false);
  // 한글 조합 중이라 미룬 성공 뒤 정리(WP-1923) — 부르면 대기를 거두고 보낸 앞부분을 바로 지운다.
  // 다음 전송(조합을 확정하는 Enter 등)이 먼저 와도 이것을 불러 보낸 글이 다시 실리지 않게 한다. 한 번에 하나뿐이다
  // (가드가 요청이 끝날 때 풀리고, 다음 전송은 시작할 때 이것을 비우므로 겹치지 않는다).
  const pendingClearRef = useRef<(() => void) | null>(null);
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
    onUpdate: ({ editor, transaction }) => {
      // 글 없이 이미지만 있어도 비어 있지 않다(WP-362). 두 모드가 같은 기준으로 onChange 에 알린다.
      const nowEmpty = isEditorBlank(editor, imagesEnabled);
      if (bodyModeEnabled) {
        // 이 편집칸에서 업로드를 한 번도 시작하지 않았으면 자리표시가 있을 수 없다 — 키 입력마다 문서를 훑지 않는다.
        const uploading = uploadSeq.current > 0 && hasPendingImage(editor);
        // 끝난 업로드의 자리표시는 실행 취소·다시 하기로만 되살아난다 — 그 트랜잭션에서만 다시 채운다.
        // 다시 채웠으면 그 트랜잭션의 onUpdate 가 새 원문·업로드 여부를 이미 알렸다 — 여기서 옛 값을 다시 알리지 않는다.
        if (uploading && isHistoryTransaction(transaction) && resettleRestoredUploads(editor)) return;
        if (uploading !== uploadingNotifiedRef.current) {
          uploadingNotifiedRef.current = uploading;
          onUploadingChangeRef.current?.(uploading);
        }
        // 다듬지 않은 원문 — 끝 줄바꿈·앞 공백도 그대로 바깥 draft 가 된다. 지난번과 같으면 알리지 않는다.
        const body = serializeToBody(editor.getJSON());
        if (body !== lastBodyRef.current) {
          lastBodyRef.current = body;
          onBodyChangeRef.current?.(body);
        }
        onChangeRef.current?.({ isEmpty: nowEmpty });
        return;
      }
      setIsEmpty(nowEmpty);
      if (imagesEnabled) {
        setImageUploading(hasPendingImage(editor));
      }
      setCharCount(serializeToBody(editor.getJSON()).trim().length);
      onChangeRef.current?.({ isEmpty: nowEmpty });
    },
    extensions: [
      Document,
      Paragraph,
      Text,
      // Shift+Enter 줄바꿈(<br>) 처리. StarterKit 포함 패키지이므로 별도 설치 불필요.
      HardBreak,
      // macOS Chrome 한글 조합을 끝내는 Enter 로 전송해도 마지막 글자가 빠지지 않게(WP-333) — 전송 판정보다 먼저 확정 글자를 반영.
      // (멘션 팝업의 후보 목록은 비동기로 갱신돼 이 순간엔 확정 전 검색어 기준이다 — 알려진 한계.)
      ImeCommitFlush,
      // placeholderRef 는 ProseMirror 가 장식을 그릴 때(렌더 이후)에만 읽히므로 안전하다(react-hooks/refs 의 보수적 false positive).
      // eslint-disable-next-line react-hooks/refs
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      ...(imagesEnabled ? [bodySetup?.image ?? RichImage] : []),
      // 본문 모드만 실행 취소 기록(Textarea 에 있던 Ctrl/Cmd+Z 를 잃지 않게). 코멘트·채팅 입력창은 지금처럼 없다.
      ...(bodyModeEnabled ? [BodyHistory] : []),
      ...(formattingEnabled ? chatFormattingExtensions : []),
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
                bodyPopupRef.current = { live: props.items.length > 0, dismissed: false, hide: () => popup?.hide() };
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
                const bodyPopup = bodyPopupRef.current;
                bodyPopup.live = !bodyPopup.dismissed && props.items.length > 0;
                component?.updateProps(props);
                popup?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                // 본문 모드: 고를 후보가 보이지 않으면(맞는 멤버 없음·Esc 로 닫음) 키를 넘긴다 — Enter 는 줄바꿈.
                // (본문 모드 Esc·Cmd/Ctrl+Enter 는 이보다 먼저 불리는 handleBodyKeyDown 이 받아 여기 오지 않는다.)
                if (bodyModeEnabled && !bodyPopupRef.current.live) return false;
                if (props.event.key === 'Escape') {
                  popup?.hide();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                popupOpenRef.current = false;
                bodyPopupRef.current = { live: false, dismissed: false, hide: null };
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
    content: initialBody
      ? bodyToDoc(initialBody, initialMentions, {
          images: imagesEnabled,
          formatting: formattingEnabled,
          // 본문 모드는 이 프로젝트 이미지만 노드로(다른 프로젝트는 글자) — 원문 왕복이 바이트 단위로 같게.
          imageProjectKey: bodySetup?.projectKey,
        })
      : undefined,
    editorProps: {
      attributes: {
        'data-testid': inputTestId,
        'aria-label': ariaLabel,
        // 한 줄 레이아웃 데스크톱은 36px(＋·보내기 버튼과 같은 높이), 그 밖은 44px 터치 타깃.
        // 모바일 한 줄은 원형 ＋·보내기와 어울리게 둥근 모서리(메인 AI 채팅 모바일 입력과 같은 rounded-2xl).
        // chat-rich-input: 빈 입력 안내를 한 줄로 자르는 CSS 범위(chat-rich-input.css, WP-1499) — 노트 에디터 등 다른 ProseMirror 와 가른다.
        // 본문 모드는 지금 본문 Textarea 와 같은 최소 160px(min-h-40) — 최대 높이는 바깥이 editorMaxHeightClass 로(데스크톱 70vh·모바일 없음).
        // 편집칸 접근성 상태(editorAria) — 지금 props 로 만든다. useEditor 는 다시 그릴 때마다 바뀐 editorProps 를 편집기에 다시 넣으므로
        // (@tiptap/react 의 setOptions) 값이 바뀌면 바로 반영된다. 그때 속성 묶음이 통째로 바뀌어 TipTap 이 처음에만 넣는 role 이 빠지므로
        // 본문 모드는 role 도 여기서 단다. 코멘트·채팅은 그대로(editorAria 없음).
        ...(bodyModeEnabled ? { role: 'textbox' } : {}),
        ...editorAriaAttributes(editorAria),
        // 본문 모드 frame='bare'(WP-1657): 테두리·rounded·배경·px/py·포커스 링 없이 글자만 — 최소 3줄(4.5rem)·모바일 입력 확대 방지로 text-base(16px).
        // 'boxed'(기본)는 아래 기존 class 그대로.
        class: bodySetup?.bare
          ? `chat-rich-input min-h-[4.5rem] ${editorMaxHeightClass} overflow-auto bg-transparent text-base leading-6 focus-visible:outline-none`
          : `chat-rich-input ${bodyModeEnabled ? 'min-h-40' : inlineSubmit ? 'min-h-11 max-lg:rounded-2xl lg:min-h-9 lg:py-1.5' : 'min-h-[44px]'} ${editorMaxHeightClass} overflow-auto rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`,
      },
      // 클립보드 파일(스크린샷 등)은 본문에 넣지 않고 첨부로 넘긴다. 텍스트가 함께 있으면 텍스트 붙여넣기(filesFromPaste).
      handlePaste: (view, event) => {
        // 본문 모드: 일반 글자가 있으면(HTML 이 함께 와도) 그 글자만 줄 단위 그대로 넣는다 — 기본 처리는 연속 줄바꿈을 합치고 HTML 을 서식으로 읽는다.
        // 열린 조각이라 첫 줄은 커서 앞 글자에, 마지막 줄은 커서 뒤 글자에 이어진다. 글자 없이 이미지 파일만 오면 아래 업로드로.
        if (bodySetup) {
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (text) {
            const slice = bodyTextToSlice(text, view.state.schema, { mentions: mentionUsers(), projectKey: bodySetup.projectKey });
            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
            return true;
          }
        }
        // 이미지 입력창이면 클립보드 이미지는 커서 자리에 넣는다(텍스트가 함께 오면 텍스트 우선 — filesFromPaste).
        if (imagesEnabled) {
          const images = filesFromPaste(event.clipboardData).filter((f) => f.type.startsWith('image/'));
          if (images.length > 0) {
            insertImagesRef.current(images);
            return true;
          }
        }
        const handler = onFilesRef.current;
        if (!handler) return false;
        const files = filesFromPaste(event.clipboardData);
        if (files.length === 0) return false;
        handler(files);
        return true;
      },
      // 파일 드롭은 ProseMirror 가 처리하지 않게만 막는다(true → preventDefault). 이벤트는 래퍼로 버블링돼
      // useComposerFileDrop 이 업로드한다 — 에디터 밖(칩 영역 등) 드롭과 한 경로로 처리하려고.
      handleDrop: (view, event) => {
        // 이미지 입력창이면 떨어뜨린 자리에 넣는다. 비이미지가 섞여도 insertImages 가 걸러 한 번만 안내한다.
        if (imagesEnabled && isFileDrag(event.dataTransfer)) {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.length > 0) {
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            insertImagesRef.current(files, at);
          }
          return true;
        }
        return !!onFilesRef.current && isFileDrag(event.dataTransfer);
      },
      // 본문 모드 복사·잘라내기 — 문단 사이 줄바꿈 하나(기본은 "\n\n" 이라 메모장에 붙이면 줄 간격이 두 배가 된다).
      ...(bodyModeEnabled ? { clipboardTextSerializer: sliceToBodyText } : {}),
      handleKeyDown: (_view, event) => {
        if (bodyModeEnabled) return handleBodyKeyDown(event);
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

  /**
   * 이미지 파일을 at(없으면 현재 커서) 자리에 각자 한 줄로 넣고 병렬 업로드한다(WP-362). 업로드 중엔 자리표시 노드로 보이고,
   * 끝나면 그 노드에 src 를 채우고, 실패하면 노드를 지우고 알린다. 형식·크기가 틀린 파일이 섞이면 한 번만 안내한다.
   * 본문 모드는 자리표시가 「줄을 나눴는가」를 직접 들고 있어(insertBodyImagePlaceholders) 실패하면 그 줄만 걷어 넣기 전 원문으로 돌린다
   * (failBodyPlaceholder — 함께 넣은 이미지 중 일부만 실패해도 남은 것만 넣은 모양이 된다).
   */
  function insertImages(files: File[], at?: number) {
    const upload = imageUpload;
    if (!editor || !upload) return;
    const valid = files.filter(isValidImageFile);
    if (valid.length < files.length) toast.error(INVALID_IMAGE_MSG);
    if (valid.length === 0) return;
    const items = valid.map((file) => ({ file, uploadId: `u${++uploadSeq.current}` }));
    const ids = items.map((i) => i.uploadId);
    if (bodyModeEnabled) insertBodyImagePlaceholders(editor, ids, at);
    else insertImagePlaceholders(editor, ids, at);
    // 업로드 하나 마무리 — 본문 모드는 결과를 기억해 두고(실행 취소로 되살린 자리표시를 다시 채우려고) 실패면 나눈 줄까지 되돌린다.
    const settle = bodyModeEnabled ? settleBodyImage : settlePendingImage;
    const finish = (uploadId: string, result: { src: string; alt: string } | null) => {
      if (bodyModeEnabled) settledUploads.current.set(uploadId, result);
      settle(editor, uploadId, result);
    };
    for (const { file, uploadId } of items) {
      upload(file)
        .then((res) => finish(uploadId, { src: res.url, alt: res.name }))
        .catch((e) => {
          finish(uploadId, null);
          // 편집기가 이미 없어졌으면(창을 버림·입력칸이 사라짐) 알릴 곳이 없으니 실패 토스트도 띄우지 않는다(WP-1657).
          if (editor.isDestroyed) return;
          toast.error(extractApiError(e, '이미지를 올리지 못했습니다'));
        });
    }
  }

  useEffect(() => {
    insertImagesRef.current = insertImages;
  });

  // 바깥 조작 핸들 — 본문 모드 바깥 「이미지」 버튼이 커서 자리에 넣고(insertImagesRef 로 늘 최신 업로드 함수), 바깥이 본문 끝으로 포커스한다.
  // editor 는 비동기로 만들어지므로 editor 가 바뀔 때(처음 만들어질 때 한 번) 핸들을 다시 만든다. 아직 없거나 파괴됐으면 포커스하지 않는다.
  useImperativeHandle(
    ref,
    () => ({
      insertImages: (files: File[]) => insertImagesRef.current(files),
      focus: () => {
        if (editor && !editor.isDestroyed) editor.commands.focus('end');
      },
      mentionUsers: () => {
        // 아래 mentionUsers() 와 같은 목록 — 함수 선언보다 앞이라 직접 모은다(컴파일러가 선언 전 접근을 막는다).
        const known = [...initialMentions, ...membersRef.current.map(toMentionUser)];
        const byId = new Map(known.map((m) => [m.id, m]));
        if (editor && !editor.isDestroyed) {
          editor.state.doc.descendants((node) => {
            if (node.type.name !== 'mention') return;
            const id = Number(node.attrs.id);
            const label = node.attrs.label as string | null | undefined;
            // 후보에서 빠진 사람도 칩에 보이던 이름을 잇는다(종류는 모르면 사람으로 둔다 — bodyToDoc 은 이름만 쓴다).
            if (!byId.has(id) && label) byId.set(id, { id, name: label, kind: 'HUMAN' });
          });
        }
        return [...byId.values()];
      },
    }),
    [editor, initialMentions],
  );

  /** 붙여넣은 <@id> 를 멘션 노드로 읽을 때 쓸 이름 목록 — 처음 본문의 멘션과 지금 후보(멤버). */
  function mentionUsers(): MentionUser[] {
    return [
      ...initialMentions,
      ...membersRef.current.map(toMentionUser),
    ];
  }

  /**
   * 본문 모드: 실행 취소가 이미 끝난 업로드의 자리표시(uploadId)를 되살렸으면 기억해 둔 결과로 다시 채운다
   * (실패였으면 처음 실패할 때와 같이 그 줄을 걷고 나눈 줄을 잇는다 — 노드만 지우면 빈 줄이 남는다).
   * 하나라도 채웠으면 true. 업로드 마무리는 실행 취소 기록에 들지 않으므로(settlePendingImage) 다시 되돌려도 자리표시로 돌아가지 않는다.
   */
  function resettleRestoredUploads(ed: NonNullable<typeof editor>): boolean {
    let changed = false;
    for (const [uploadId, result] of settledUploads.current) {
      if (settleBodyImage(ed, uploadId, result)) changed = true;
    }
    return changed;
  }

  /**
   * 본문 모드 키 — Enter 는 기본(줄바꿈)으로 두고, Cmd/Ctrl+Enter 는 저장(onSubmit), Esc 는 취소(onCancel).
   * Cmd/Ctrl+Enter 는 멘션 팝업이 열려 있어도 늘 저장이다 — 팝업은 수식키가 붙은 Enter 도 「고르기」로 받아 저장이 되지 않았다.
   * (이 처리기가 제안 플러그인보다 먼저 불리므로 여기서 받으면 멘션이 끼어들지 않는다. 업로드 중엔 저장하지 않고 키만 받는다.)
   * Esc 는 handleBodyEscape(후보가 보이는 팝업이면 닫기만). 그냥 Enter 는 넘겨, 후보가 보이면 팝업이 고르고 아니면 줄바꿈이다.
   */
  function handleBodyKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitBody();
      return true;
    }
    if (event.key === 'Escape') {
      const handled = handleBodyEscape();
      if (handled) event.preventDefault();
      return handled;
    }
    return false;
  }

  /**
   * 본문 모드 Esc — 고를 후보가 보이는 멘션 팝업이 있으면 팝업만 닫고(본문 편집 전체가 닫히지 않게), 없으면 onCancel.
   * 키 처리(handleBodyKeyDown)와 바깥이 막은 Esc(handleBlockedEscape)가 함께 쓴다. 처리했으면 true.
   */
  function handleBodyEscape(): boolean {
    const bodyPopup = bodyPopupRef.current;
    if (bodyPopup.live) {
      bodyPopup.live = false;
      bodyPopup.dismissed = true;
      bodyPopup.hide?.();
      return true;
    }
    if (!onCancel) return false;
    onCancel();
    return true;
  }

  /**
   * 본문 모드 — 바깥(개인 작업 상세 모달 등)이 문서 캡처 단계에서 이미 막은 Esc(preventDefault — 모달이 닫히지 않게).
   * ProseMirror 는 막힌 이벤트를 아예 처리하지 않으므로(eventBelongsToView — handleDOMEvents 도 부르지 않는다) 편집칸 감싸개의 캡처 단계
   * (문서 캡처 뒤·편집기 앞)에서 직접 처리한다 — 평소 Esc 와 같은 handleBodyEscape(취소 판단·업로드 중 무시는 바깥 몫). 한글 조합 중 Esc 는 넘긴다.
   * 막히지 않은 Esc 는 평소 경로(handleBodyKeyDown)로 넘긴다. 이 함수는 렌더마다 감싸개에 다시 달리므로 onCancel 을 바로 읽어도 최신이다.
   */
  function handleBlockedEscape(event: React.KeyboardEvent) {
    const native = event.nativeEvent;
    if (event.key !== 'Escape' || !native.defaultPrevented || isImeComposing(native)) return;
    handleBodyEscape();
  }

  /** 본문 모드 저장 — 다듬지 않은 지금 원문을 그대로 넘긴다. 변경 없음·글자 수 판단은 바깥 몫이고, 업로드 중엔 부르지 않는다. */
  function submitBody() {
    if (!editor) return;
    if (hasPendingImage(editor)) return;
    onSubmitRef.current(serializeToBody(editor.getJSON()));
  }

  // 안내 문구가 바뀌면 빈 트랜잭션으로 Placeholder 장식을 다시 계산하게 한다.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr);
  }, [editor, placeholder]);

  // 포커스 요청(WP-1372) — 대기 중인 요청이 있고 에디터가 준비되면 본문 끝에 포커스하고 끝났다고 알린다(호출처가 요청을 0 으로 돌린다).
  // 스크롤은 호출처가 맞췄으므로 scrollIntoView 를 끈다.
  useEffect(() => {
    if (focusRequest <= 0 || !editor || editor.isDestroyed) return;
    editor.commands.focus('end', { scrollIntoView: false });
    onFocusRequestDone?.();
  }, [editor, focusRequest, onFocusRequestDone]);

  /**
   * 전송 성공 뒤 입력창 정리(WP-1923) — 전송 중 이어서 입력한 글자는 지우지 않는다.
   * 보낸 문서가 지금 문서와 같으면 비우고, 앞부분이면 그 부분만 지우고, 보낸 부분을 고쳤으면 아무것도 지우지 않는다.
   */
  function clearSent(sentDoc: PMNode, refocus: boolean) {
    if (!editor || editor.isDestroyed) return;
    const end = sentPrefixEnd(sentDoc, editor.state.doc);
    if (end === 'same') {
      // clearContent(emitUpdate=true) — TipTap 2.27.2 의 clearContent 기본값(false)은
      // onUpdate 를 발생시키지 않아, 전송 직후 isEmpty/charCount 가 stale(false/직전값)로 남는다.
      // 그 결과 disableWhenEmpty 컴포저(이슈 챗 ChatComposer 등)에서 전송 후 빈 입력인데도
      // 보내기 버튼이 활성으로 남아 클릭 시 silent no-op 이 되는 회귀(#197)가 발생.
      // true 를 전달해 update 를 강제 → onUpdate 가 isEmpty=true / charCount=0 을 동기화.
      editor.commands.clearContent(true);
    } else if (end != null) {
      // 보낸 앞부분만 지운다 — deleteRange 도 update 를 내므로 isEmpty/charCount 가 동기화된다.
      editor.commands.deleteRange({ from: 0, to: end });
    }
    // end == null(보낸 부분을 고침)이면 아무것도 지우지 않는다 — 글자를 잃는 것보다 남는 쪽이 안전.
    // 조합 끝을 기다렸다 지울 때는 초점을 당기지 않는다 — 조합은 흔히 다른 칸을 눌러(blur) 끝나므로 그 칸의 입력을 뺏게 된다.
    if (refocus) editor.commands.focus();
  }

  function submit() {
    if (!editor) return;
    // 업로드 중 이미지가 있으면 버튼·Enter 모두 막는다 — 자리표시가 빈 이미지로 저장되지 않게(WP-362).
    if (imagesEnabled && hasPendingImage(editor)) return;
    // 인플라이트 가드(#586) — 이미 전송 중이면 재호출 무시. 버튼 onClick·Enter 키 두 경로가
    // 모두 이 함수를 거치므로 여기 하나로 양쪽 다 차단된다.
    if (submittingRef.current) return;
    // 외부에서 전송을 차단한 경우(파일 업로드 중 등) 버튼·Enter 양쪽 모두 차단.
    if (submitDisabledRef.current) return;
    // 앞 전송의 정리가 조합 끝을 기다리는 중이면(WP-1923 리뷰 후속) — 조합을 확정하는 Enter 가 여기로 온다.
    // 버리지 않고 보낸 앞부분을 지금 지운 뒤 남은 글로 이어 보낸다. 아직 조합 중이면(초점을 뺏지 않는 버튼을 누름 등) 지우면 조합이
    // 깨지므로 조합이 끝난 뒤 다시 보낸다 — 눌러도 아무 일 없는 버튼이 되지 않게(#197 과 같은 무반응 방지).
    if (pendingClearRef.current) {
      if (editor.view.composing) {
        waitCompositionIdle(editor).promise.then(submit, () => {});
        return;
      }
      pendingClearRef.current();
    }
    const body = serializeToBody(editor.getJSON()).trim();
    // 본문이 비어도 첨부가 있으면(allowEmptySubmit) 제출 허용.
    if (body.length === 0 && !allowEmptyRef.current) return;
    // maxLength 초과 시 버튼·Enter 양쪽 모두 차단(서버 @Size 검증과 동일 기준).
    if (maxLengthRef.current != null && body.length > maxLengthRef.current) return;
    // 변경 없는 저장은 no-op — onCancel 로 닫아 불필요한 update 호출을 막는다 (#44).
    // composer 는 initialBody='' + body 비어있지 않음이라 절대 매칭되지 않는다.
    // 본문 밖 변경(첨부 빼기 등)이 있으면 본문이 같아도 저장한다.
    if (body === initialCompare && onCancel && !changedOutsideBodyRef.current) {
      onCancel();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    // 보낸 시점의 문서를 기억한다 — 전송 중 새로 입력한 글자를 성공 시 지우지 않으려고(WP-1923).
    const sentDoc = editor.state.doc;
    const result = onSubmitRef.current(body);
    // 가드 해제는 요청이 끝날 때 이 한 곳에서만 한다(아래 finally) — 조합 끝을 기다리는 정리와 상관없이 전송 중 표시를 푼다.
    // 순번 확인 없이 풀어도 되는 까닭: release 는 아래 성공·실패 처리(동기)가 끝난 뒤 finally 로 돌고, 새 전송은 가드가 풀린 뒤에야
    // 시작되므로 앞 전송의 release 가 새 전송의 가드를 풀 일이 없다. 성공 처리를 다시 async 로 바꾸면 이 전제가 깨지니 주의.
    const release = () => {
      submittingRef.current = false;
      // 언마운트된 뒤에는 state 를 건드리지 않는다.
      if (!editor.isDestroyed) setSubmitting(false);
    };
    // onSubmit 이 void 를 반환해도 Promise.resolve 가 즉시 resolve 된 Promise 로 감싸므로
    // release 는 항상 마이크로태스크에서 실행된다 — 동일 이벤트 루프 틱 내 동기적으로
    // 발생하는 추가 클릭은 그 전에 이미 위 가드에서 차단됨(WikiCreateSpaceDialog#581과 동일 원리).
    if (!clearOnSubmit) {
      Promise.resolve(result).then(release, release);
      return;
    }
    // 성공 시에만 입력창을 비운다(#123). onSubmit 이 전송 mutation Promise 를 반환하면
    // resolve(성공) 후 clear, reject(전송 실패) 면 입력을 보존해 즉시 재시도할 수 있게 한다.
    // void 반환(첨부 attach 등 비-Promise 경로)이면 resolve 로 취급해 기존처럼 비운다.
    Promise.resolve(result)
      .then(
        () => {
          // 비동기 resolve 시점에 언마운트됐을 수 있으므로 editor 파괴 여부를 확인.
          if (editor.isDestroyed) return;
          if (!editor.view.composing) {
            clearSent(sentDoc, true);
            return;
          }
          // 한글 조합 중에 지우면 조합이 끊긴다 — 조합이 끝날 때까지 기다린 뒤 지운다. 기다리는 동안 다음 전송이 오면
          // submit 이 pendingClearRef 를 불러 먼저 지운다. 취소(언마운트)면 지우지 않는다.
          const wait = waitCompositionIdle(editor);
          const flush = () => {
            if (pendingClearRef.current !== flush) return;
            pendingClearRef.current = null;
            wait.cancel();
            clearSent(sentDoc, false);
          };
          pendingClearRef.current = flush;
          wait.promise.then(flush, () => {
            if (pendingClearRef.current === flush) pendingClearRef.current = null;
          });
        },
        () => {
          // 전송 실패: 입력 유지. 포커스만 복귀시켜 재시도 가능하게.
          if (editor.isDestroyed) return;
          editor.commands.focus();
        },
      )
      .finally(release);
  }

  // 전송 버튼 비활성 조건 — 두 레이아웃(기본·inlineSubmit)이 공유.
  // disableWhenEmpty=true 이고 본문도 비고 첨부도 없을 때만 비활성화(opt-in). allowEmptySubmit 은 렌더 시점 prop 직접 참조 — ref 는 submit(Enter 경로) 전용.
  // submitDisabled 는 외부 상태(업로드 중 등)로 강제 비활성화. maxLength 초과 시도 비활성화 — charCount 와 동일 기준.
  // submitting 은 인플라이트 가드(#586)의 시각적 반영 — 실제 중복 제출 차단은 submittingRef 가 담당.
  const submitBlocked =
    submitDisabled ||
    imageUploading ||
    submitting ||
    (disableWhenEmpty ? isEmpty && !allowEmptySubmit : false) ||
    (maxLength != null && charCount > maxLength);

  // 상한 초과 안내(overLimitMessage 가 있을 때만) — 두 레이아웃이 공유. 전송은 submitBlocked·submit() 가드가 막는다.
  const limitError =
    maxLength != null && overLimitMessage && charCount > maxLength ? (
      <p
        role="alert"
        id={`${inputTestId}-limit-error`}
        data-testid={`${inputTestId}-limit-error`}
        className="text-sm text-destructive"
      >
        {overLimitMessage(charCount)}
      </p>
    ) : null;

  // 서식 토글·도구 줄(formatting 일 때만). 토글은 ＋ 옆, 줄은 입력 위.
  const formatToggle = formattingEnabled ? (
    <ChatFormatToggle open={toolbarOpen} onToggle={toggleToolbar} testId={`${inputTestId}-format`} />
  ) : null;
  const formatToolbar =
    formattingEnabled && toolbarOpen && editor ? <ChatFormatToolbar editor={editor} testId={`${inputTestId}-format`} /> : null;

  // 본문 모드는 편집칸만 — 저장·취소·이미지 버튼, 초안·글자 수 안내는 바깥(InlineEditableBody)이 그린다.
  if (bodyModeEnabled) {
    return (
      <div data-testid={`${inputTestId}-wrap`} onKeyDownCapture={handleBlockedEscape}>
        <EditorContent editor={editor} />
      </div>
    );
  }

  if (inlineSubmit) {
    // 한 줄 레이아웃 [leftActions] [에디터] [전송] — 에디터만 min-w-0 flex-1 로 늘고(좁은 폭에서 TipTap 이 넘치지 않게) 양옆은 하단 정렬.
    // 카운터는 한도 80% 초과 시에만 — 평소엔 하단 줄 높이를 늘리지 않는다.
    const showCount = maxLength != null && charCount > maxLength * 0.8;
    return (
      <div className="flex flex-col gap-1" data-testid={`${inputTestId}-wrap`} data-chat-formatting={formattingEnabled ? '' : undefined}>
        {formatToolbar}
        <div className="flex flex-row items-end gap-2">
          {imagesEnabled && <IssueBodyImageButton compact onFiles={insertImages} testId={`${inputTestId}-image`} />}
          {(leftActions || formatToggle) && (
            <div className="flex shrink-0 items-center gap-1">
              {leftActions}
              {formatToggle}
            </div>
          )}
          <div className="relative min-w-0 flex-1">
            <EditorContent editor={editor} />
          </div>
          {/* 전송: 모바일은 44px 원형 아이콘(메인 AI 채팅 모바일 전송과 같은 메신저 관례), 데스크톱은 텍스트 버튼(에디터 한 줄 36px 와 같은 높이).
              에디터처럼 CSS 브레이크포인트로만 바꾼다 — 라벨이 '업로드 중…' 으로 바뀌면 데스크톱엔 글자로, 모바일엔 접근 이름으로 전달. */}
          <Button
            type="button"
            className="relative shrink-0 max-lg:size-11 max-lg:rounded-full max-lg:p-0"
            aria-label={submitLabel}
            onClick={submit}
            {...keepFocusProps}
            data-testid={submitTestId}
            disabled={submitBlocked}
            aria-busy={submitting || undefined}
          >
            {/* 전송 중(WP-1860): 스피너 한 개를 두 브레이크포인트 공용으로 쓴다(testid 중복 방지).
                버튼 크기가 바뀌면 입력 줄이 흔들리므로(anti-goal) 아이콘·글자는 레이아웃에 그대로 두고 invisible 로만 숨기며,
                스피너는 래퍼 span 에 담아 버튼 정중앙에 절대 배치한다(래퍼라서 Button 의 has-[>svg] 패딩 규칙도 건드리지 않는다). */}
            <ArrowUp className={`size-5 lg:hidden ${submitting ? 'invisible' : ''}`} aria-hidden />
            <span className={`max-lg:hidden ${submitting ? 'invisible' : ''}`}>{submitLabel}</span>
            {submitting && <SubmitSpinnerOverlay testId={`${submitTestId}-spinner`} iconClassName="size-5 lg:size-4" />}
          </Button>
        </div>
        {limitError}
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
    <div className="flex flex-col gap-2" data-testid={`${inputTestId}-wrap`} data-chat-formatting={formattingEnabled ? '' : undefined}>
      {formatToolbar}
      <div className="relative">
        <EditorContent editor={editor} />
      </div>
      {limitError}
      {/* leftActions 가 있으면 justify-between 으로 좌우 분리, 없으면 justify-end 로 우측 정렬. */}
      <div className={`flex items-center gap-2 ${leftActions || imagesEnabled || formatToggle ? 'justify-between' : 'justify-end'}`}>
        {(leftActions || imagesEnabled || formatToggle) && (
          <div className="flex items-center gap-1">
            {imagesEnabled && <IssueBodyImageButton onFiles={insertImages} testId={`${inputTestId}-image`} />}
            {leftActions}
            {formatToggle}
          </div>
        )}
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
            className="relative max-lg:h-11"
            onClick={submit}
            {...keepFocusProps}
            data-testid={submitTestId}
            disabled={submitBlocked}
            aria-busy={submitting || undefined}
            // 전송 중엔 글자 span 이 invisible(visibility:hidden)이라 접근성 트리에서 빠진다 — 이름을 라벨로 고정해 항상 유지한다.
            aria-label={submitLabel}
          >
            {/* 전송 중(WP-1860): 글자는 invisible 로 폭을 유지하고 스피너를 정중앙에 겹친다 — 디자인 시스템 06 §A-3.
                래퍼 span 이라 Button 의 has-[>svg] 패딩(px-3 → px-2.5)이 바뀌지 않는다. */}
            <span className={submitting ? 'invisible' : undefined}>{submitLabel}</span>
            {submitting && <SubmitSpinnerOverlay testId={`${submitTestId}-spinner`} iconClassName="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 보내기 버튼 전송 중 스피너(WP-1860) — 버튼(relative) 정중앙에 절대 배치해 버튼 폭을 바꾸지 않는다.
 * 래퍼 span 에 담는 까닭: Button 의 has-[>svg] 패딩 규칙이 직계 svg 를 보고 패딩을 바꾸기 때문이다.
 * 두 레이아웃(inlineSubmit·기본)이 같은 모양을 쓰도록 한곳에 둔다 — 아이콘 크기만 다르다.
 */
function SubmitSpinnerOverlay({ testId, iconClassName }: { testId: string; iconClassName: string }) {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <Loader2 className={`${iconClassName} animate-spin`} aria-hidden data-testid={testId} />
    </span>
  );
}
