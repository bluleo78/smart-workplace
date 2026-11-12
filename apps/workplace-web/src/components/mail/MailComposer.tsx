// 메일 본문 리치 텍스트 에디터(Tiptap). 굵게/기울임/목록/링크 최소 툴바.
// 외부엔 getHTML()/getText() 를 onChange 로 흘려보낸다(저장은 상위 도크가 담당).
// chat RichInput 과 분리 — 멘션/suggestion 배선이 없는 독립 인스턴스.

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Link2, List, ListOrdered, Table2, Type } from 'lucide-react';
import type { ReactNode } from 'react';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { extractApiError } from '@/lib/api-error';
import { filesFromPaste, isFileDrag } from '@/lib/clipboardFiles';
import { downscaleImageForUpload } from '@/lib/imageDownscale';
import { INVALID_IMAGE_MSG, isValidImageFile } from '@/lib/imageUpload';
import { ImeCommitFlush } from '@/lib/imeCommitFlush';
import { dropForeignPastedImages, PASTED_IMAGE_DOWNSCALE, pastedImageIds, pastedImageSrc } from '@/lib/mailPastedImages';
import { cn } from '@/lib/utils';

import { hasPendingImage, insertImagePlaceholders } from '../mentions/richImageNode';
import { applyLink, MailLink } from './mailEditorLink';
import { MAIL_FORMAT_EXTENSIONS } from './mailFormatExtensions';
import { MailFormatRow } from './MailFormatRow';
import { MailFormatSheet } from './MailFormatSheet';
import { MAIL_BOXED_ROW_CLASS } from './mailFormatUi';
import { MailImage, type PastedImageResult, settleMailImages } from './mailImageNode';
import {
  bringCaretAbovePanel,
  MAIL_MOBILE_FORMAT_BAR_CLASS,
  MAIL_MOBILE_PANEL_CLASS,
  MAIL_MOBILE_PANEL_RESERVE_CLASS,
  MAIL_MOBILE_TABLE_ROW_ID,
  MAIL_MOBILE_TABLE_ROW_RESERVE_CLASS,
} from './mailMobileBars';
import { mailBodyInfo, mailComposerHtml, MailSignature } from './mailSignatureNode';
import { insertMailTable, MAIL_TABLE_EXTENSIONS, MAIL_TABLE_GRID_MAX } from './mailTable';
import { MailTableGridPicker } from './MailTableGridPicker';
import { MailTableToolbar } from './MailTableToolbar';
import { ToolbarButton } from './MailToolbarButton';
import { useCaretInTable } from './useCaretInTable';
import { useMailFormatRowOpen } from './useMailFormatRowOpen';

/**
 * 에디터 배치 — 작성창 모양에 따라 본문 크기·툴바 위치가 달라진다.
 * - dock: 작은 작성창. 본문 높이 상한(40vh) + 세로 스크롤.
 * - fill: 데스크톱 크게 보기(WP-575). 상한을 풀고 남은 높이를 다 채운다.
 * - mobile: 모바일 화면 전체 작성(WP-583). 테두리 없는 본문, 서식 버튼은 화면 맨 아래(키보드가 열리면 그 바로 위).
 */
export type MailComposerLayout = 'dock' | 'fill' | 'mobile';

/** 본문 변경과 함께 넘기는 판정(WP-1517) — 서명 블록이 본문에 있는가, 서명 밖 본문이 비었는가(글자도 이미지도 없음). */
interface MailComposerChangeInfo {
  hasSignature: boolean;
  bodyEmpty: boolean;
}

interface MailComposerProps {
  /** 초기 HTML(답장/전달 인용문). */
  initialHtml?: string;
  /**
   * 본문 변경 시 HTML+텍스트 동시 전달. initial=true 는 에디터가 처음 만들어질 때(사용자 편집 아님)의 값이다.
   * info 는 서명 블록 유무와 서명 밖 본문이 비었는지(WP-1517) — 펜 단추 상태와 「본문 있음」 판정에 쓴다.
   */
  onChange: (html: string, text: string, initial: boolean, info: MailComposerChangeInfo) => void;
  /** 작성창 모양에 맞춘 배치. 기본 dock. */
  layout?: MailComposerLayout;
  /** 서식 툴바 오른쪽 끝에 붙일 것(새 메일 「AI로 쓰기」, WP-576). 붙일 쪽이 ml-auto 로 끝에 민다. */
  toolbarEnd?: ReactNode;
  /** 본문 위에 겹쳐 그릴 것(빈 본문 AI 칩·생성 중 스켈레톤, WP-576). 본문 글자 자리(안쪽 여백)에 맞춰 놓이고, 빈 곳은 클릭이 본문으로 통과한다. */
  bodyOverlay?: ReactNode;
  /**
   * 클립보드 이미지(화면 캡처) 붙여넣기(WP-947) — 주면 Ctrl/Cmd+V 한 이미지를 커서 자리에 넣고 이 함수로 올린다(작성창 업로드 id 를 돌려준다).
   * 없으면 지금처럼 이미지를 받지 않는다.
   */
  imageUpload?: (file: File) => Promise<number>;
}

/**
 * 배치별 본문(ProseMirror) 클래스. editorProps 는 렌더마다 setOptions 로 다시 적용되므로
 * 같은 에디터 인스턴스로 작은 창 ↔ 크게 보기를 오가도 쓰던 내용을 잃지 않고 크기만 바뀐다.
 */
const BOXED_EDITOR_CLASS =
  'overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const EDITOR_CLASS: Record<MailComposerLayout, string> = {
  dock: `min-h-[180px] max-h-[40vh] ${BOXED_EDITOR_CLASS}`,
  fill: `min-h-[12rem] flex-1 ${BOXED_EDITOR_CLASS}`,
  mobile: 'min-h-[30vh] bg-background py-2 text-[15px] leading-relaxed focus-visible:outline-none',
};

/**
 * 배치별 서식 툴바 클래스 — 모바일은 화면 하단 고정(키보드 높이 --kb-inset 만큼 띄움).
 * 크게 보기는 에디터가 끝없이 늘고 창 본문이 스크롤되므로 툴바를 위에 붙인다 — 비치지 않게 배경을 깔고 그 위에 같은 옅은 색을 겹친다.
 */
const BOXED_TOOLBAR_CLASS = MAIL_BOXED_ROW_CLASS;
const TOOLBAR_CLASS: Record<MailComposerLayout, string> = {
  dock: BOXED_TOOLBAR_CLASS,
  fill: cn(BOXED_TOOLBAR_CLASS, 'bg-background bg-linear-to-r from-muted/40 to-muted/40'),
  // 모바일 서식 줄 — 표 막대 등 위에 쌓는 줄이 이 높이에 맞춰 붙도록 클래스를 mailMobileBars 한곳에 둔다.
  mobile: MAIL_MOBILE_FORMAT_BAR_CLASS,
};

/**
 * 본문 겹침 자리 — 에디터 안쪽 여백(boxed px-3 py-2, mobile py-2)과 맞춰 첫 줄 높이에 놓는다.
 * pointer-events-none 이라 겹침의 빈 곳을 눌러도 본문에 커서가 간다(겹친 버튼은 스스로 pointer-events-auto).
 */
const BOXED_OVERLAY_CLASS = 'pointer-events-none absolute inset-x-3 top-1.5 [&_button]:pointer-events-auto';
const OVERLAY_CLASS: Record<MailComposerLayout, string> = {
  dock: BOXED_OVERLAY_CLASS,
  fill: BOXED_OVERLAY_CLASS,
  mobile: 'pointer-events-none absolute inset-x-0 top-1.5 [&_button]:pointer-events-auto',
};

/** 모바일에서 서식 줄 위 자리를 쓰는 것 — 서식판·표 격자 패널·표 막대 고정 줄 중 하나(없으면 null). */
type MobilePanel = 'format' | 'table' | 'tableRow';

/** 열린 모바일 패널별 본문 아래 빈 자리 — 서식판·표 패널은 패널 최대 높이, 표 막대 줄은 줄 높이. 칸 id 는 테스트가 본다. */
const PANEL_RESERVE: Record<MobilePanel, { testId: string; className: string }> = {
  format: { testId: 'mail-mobile-panel-reserve', className: MAIL_MOBILE_PANEL_RESERVE_CLASS },
  table: { testId: 'mail-mobile-panel-reserve', className: MAIL_MOBILE_PANEL_RESERVE_CLASS },
  tableRow: { testId: 'mail-mobile-table-row-reserve', className: MAIL_MOBILE_TABLE_ROW_RESERVE_CLASS },
};

/**
 * 링크 주소 입력 다이얼로그(window.prompt 대체, #148) — 작성창과 서명 편집기가 같이 쓴다. 주소 값은 부르는 쪽이 들고,
 * Enter·확인은 onConfirm, 취소·바깥 닫기는 onCancel 로 알린다.
 */
export function LinkUrlDialog({
  open,
  url,
  onUrlChange,
  onConfirm,
  onCancel,
  testId = 'link-url-dialog',
}: {
  open: boolean;
  url: string;
  onUrlChange: (url: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** 대화상자 data-testid — 서명 편집기는 작성창과 다른 값을 쓴다. */
  testId?: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>링크 삽입</DialogTitle>
          <DialogDescription className="sr-only">링크 삽입</DialogDescription>
        </DialogHeader>
        <Input
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onConfirm();
            }
          }}
          placeholder="https://"
          autoFocus
          aria-label="링크 주소"
          data-testid="link-url-input"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            취소
          </Button>
          <Button onClick={onConfirm} data-testid="link-url-confirm">
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 부모(작성 도크)가 본문을 통째로 교체할 수 있게 노출하는 핸들. */
export interface MailComposerHandle {
  /**
   * 본문 통째 교체(undo 히스토리에 쌓인다). focus=false 면 초점을 옮기지 않는다 — 응답이 늦게 도착한 AI 초안(WP-576)이
   * 그사이 제목 등을 쓰던 사용자의 초점을 빼앗지 않게. 기본 true(개선본으로 교체처럼 사용자가 누른 직후).
   */
  setContent: (html: string, opts?: { focus?: boolean }) => void
  /** 본문 끝에 초점 — AI 초안을 넣은 뒤 렌더가 끝나(inert 해제) 바로 이어 쓸 수 있게(WP-576). */
  focusEnd: () => void
  /** 붙여 넣은 이미지가 아직 올라가는 중인가(WP-947) — 그동안 보내면 빈 그림이 나가므로 보내기를 막는다. */
  hasPendingImage: () => boolean
  /** 서명 넣기(WP-1517) — 있던 서명을 빼고 본문 끝에 빈 줄 하나 + 서명을 넣는다(실행 취소 기록에 쌓인다). */
  insertSignature: (html: string) => void
  /** 서명 빼기(WP-1517) — 본문의 서명 블록을 모두 빼고 그 앞 빈 줄 하나도 뺀다. */
  removeSignature: () => void
  /**
   * 처음 본문에 서명 자동 넣기(WP-1517) — 서명 조회가 작성창보다 늦게 끝났을 때 쓴다. 사용자가 한 편집이 아니므로 실행 취소 기록에 쌓지 않고,
   * onChange 를 initial=true 로 알려 처음 본문(baseline)에 들어가게 한다(서명만 있는 새 메일이 임시저장되지 않게).
   */
  insertInitialSignature: (html: string) => void
}

/** insertInitialSignature 트랜잭션 표식 — onUpdate 가 이것을 보고 onChange 의 initial 을 true 로 알린다. */
const INITIAL_SIGNATURE_META = 'mailInitialSignature';

/** 메일 본문 작성 에디터. */
export const MailComposer = forwardRef<MailComposerHandle, MailComposerProps>(
  function MailComposer({ initialHtml = '', onChange, layout = 'dock', toolbarEnd, bodyOverlay, imageUpload }, ref) {
  // 링크 URL 입력 다이얼로그 — window.prompt 대체 (#148).
  const [linkDialog, setLinkDialog] = useState(false);
  // 서식 둘째 줄 펼침 — 작성창을 새로 열어도 이어지게 기억한다(처음엔 접힘).
  const [formatOpen, setFormatOpen] = useMailFormatRowOpen();
  const formatRowId = useId();
  // 모바일 표 격자 패널(6×6) 열림 — 서식판과 같은 자리를 쓰므로 둘 중 하나만 연다. 기억하지 않는다(한 번 쓰고 닫는 패널).
  const [tablePanelOpen, setTablePanelOpen] = useState(false);
  const tablePanelId = useId();
  const [linkUrl, setLinkUrl] = useState('');
  // 붙여넣기 처리기 — editorProps 는 에디터를 만들 때 한 번 정해지므로 최신 함수(에디터·업로드)를 ref 로 넘긴다.
  const insertImagesRef = useRef<(files: File[]) => boolean>(() => false);
  const uploadSeq = useRef(0);
  // 끝난 업로드 결과(자리표시 id → 그림·실패) — 실행 취소로 되살아난 자리표시도 다시 맞춘다(settleMailImages).
  const pastedResults = useRef(new Map<string, PastedImageResult>());
  // 이 작성창의 본문 이미지 업로드 id — 처음 본문(임시저장)에 있던 것과 여기서 올린 것. 다른 작성의 그림을 복사해 붙이면 빼는 기준이다.
  const [ownedImageIds] = useState(() => new Set(pastedImageIds(initialHtml)));

  const editor = useEditor({
    extensions: [
      StarterKit,
      // 붙여 넣은 기존 <a> 의 href 를 지키는 링크(WP-1517) — 입력·붙여넣기의 주소 글자 자동 링크는 그대로.
      MailLink,
      // 메일 서식(WP-1524) — 받는 쪽에서 같게 보이도록 인라인 style 로 내보낸다
      ...MAIL_FORMAT_EXTENSIONS,
      // 메일 안전 표(WP-1524) — class·colgroup 없이 인라인 테두리·여백만 지닌다(표 확장은 이것 하나만 등록).
      ...MAIL_TABLE_EXTENSIONS,
      // macOS Chrome 한글 조합을 끝내는 Enter 가 마지막 글자를 지우지 않게(WP-333).
      ImeCommitFlush,
      // 붙여 넣은 캡처(WP-947). 업로드 경로 <img> 만 받으므로 이미지를 받지 않는 작성창에서도 다른 <img> 는 지금처럼 버려진다.
      MailImage,
      // 서명 블록(WP-1517) — 원문 서명 HTML 을 원자 노드로 들고 격리 iframe 으로 그린다.
      MailSignature,
    ],
    content: initialHtml,
    // 도크가 열리면 "받는사람"으로 포커스를 명시적으로 보낸다(#802) — 에디터가 자동으로
    // 포커스를 가져가면 수신자→제목→본문 순서를 건너뛰게 되므로 여기서는 비활성화.
    autofocus: false,
    // 마운트 직후 refs 를 초기화해 상위 도크가 빈 본문 상태를 정확히 알게 한다.
    // (인용문은 에디터 밖에서 관리되므로 여기 포함되지 않는다 — 설계 §3)
    // 본문 HTML 은 getHTML 대신 mailComposerHtml — 서명 HTML 이 앱 문서에 붙지 않게 비활성 문서로 직렬화한다(mailSignatureNode).
    onCreate: ({ editor }) => onChange(mailComposerHtml(editor), editor.getText(), true, mailBodyInfo(editor.state.doc)),
    onUpdate: ({ editor, transaction }) => {
      // 실행 취소·다시 실행(history 플러그인 메타가 붙은 변경)으로 끝난 업로드의 자리표시가 돌아왔으면 먼저 그림으로 맞춘다
      // (그 고침이 다시 onUpdate 로 이어진다). 자리표시는 그 경로로만 되살아나므로 타자마다 문서를 훑지 않는다.
      if (transaction.getMeta('history$') && pastedResults.current.size > 0 && hasPendingImage(editor)) {
        settleMailImages(editor, pastedResults.current);
        return;
      }
      // 처음 본문에 늦게 넣은 서명(insertInitialSignature)은 사용자 편집이 아니다 — 처음 값으로 알린다.
      const initial = transaction.getMeta(INITIAL_SIGNATURE_META) === true;
      onChange(mailComposerHtml(editor), editor.getText(), initial, mailBodyInfo(editor.state.doc));
    },
    editorProps: {
      // 파일을 본문 위에 놓으면 에디터는 아무것도 넣지 않고 넘긴다 — 놓기 이벤트는 그대로 버블돼 작성창(useComposerFileDrop)이 첨부로 받는다(WP-574).
      // 글자·서식 끌어 놓기(파일 아님)는 에디터 기본 동작 그대로.
      handleDrop: (_view, event) => isFileDrag(event.dataTransfer),
      // 클립보드 이미지(화면 캡처)는 커서 자리에 넣는다(WP-947). 텍스트가 함께 오면(문서에서 복사) 텍스트 붙여넣기가 우선이다(filesFromPaste).
      handlePaste: (_view, event) => {
        const images = filesFromPaste(event.clipboardData).filter((f) => f.type.startsWith('image/'));
        return images.length > 0 && insertImagesRef.current(images);
      },
      // 다른 작성창(임시저장)에서 복사해 온 본문 이미지는 뺀다 — 그 업로드가 이 임시저장으로 옮겨 묶이면 원래 쪽 그림이 깨진다.
      transformPastedHTML: (html) => dropForeignPastedImages(html, ownedImageIds),
      attributes: {
        'data-testid': 'mail-composer-body',
        'aria-label': '메일 본문',
        // 배치별 크기(EDITOR_CLASS). prose 계열 클래스는 쓰지 않는다(#743) — 블록 요소 스타일은 index.css 의 .ProseMirror 규칙(#738).
        class: EDITOR_CLASS[layout],
      },
    },
  });

  // 개선본 교체용 — emitUpdate=true 로 onChange 도 발화되고 undo 히스토리에 쌓임.
  useImperativeHandle(
    ref,
    () => ({
      setContent: (html: string, opts?: { focus?: boolean }) => {
        if (!editor) return
        // Tiptap v2.27 — setContent(content, emitUpdate) 위치 인자. emitUpdate=true 로 onChange 발화 + undo 누적.
        const chain = opts?.focus === false ? editor.chain() : editor.chain().focus()
        chain.setContent(html, true).run()
      },
      focusEnd: () => {
        editor?.commands.focus('end')
      },
      hasPendingImage: () => (editor ? hasPendingImage(editor) : false),
      // 펜 단추로 넣고 빼므로 초점을 옮기지 않는다 — 단추를 누른 자리(받는사람·제목 등)에서 계속 쓰게.
      insertSignature: (html: string) => {
        editor?.commands.insertMailSignature(html)
      },
      removeSignature: () => {
        editor?.commands.removeMailSignature()
      },
      insertInitialSignature: (html: string) => {
        editor
          ?.chain()
          .command(({ tr }) => {
            tr.setMeta('addToHistory', false).setMeta(INITIAL_SIGNATURE_META, true)
            return true
          })
          .insertMailSignature(html)
          .run()
      },
    }),
    [editor],
  )

  /**
   * 이미지마다 한 줄로 커서 자리에 넣고 올린다(WP-947, 이슈 코멘트 입력창 RichInput 과 같은 배치). 올리는 동안은 자리표시로 보이고,
   * 끝나면 업로드 경로로 채우며, 실패하면 자리표시를 지우고 알린다. 큰 캡처는 올리기 전에 줄인다(PASTED_IMAGE_DOWNSCALE).
   */
  function insertImages(files: File[]): boolean {
    const upload = imageUpload;
    if (!editor || !upload) return false;
    const items = files.map((file) => ({ file, uploadId: `p${++uploadSeq.current}` }));
    insertImagePlaceholders(editor, items.map((i) => i.uploadId));
    for (const { file, uploadId } of items) {
      downscaleImageForUpload(file, PASTED_IMAGE_DOWNSCALE)
        .then((ready) => {
          if (!isValidImageFile(ready)) throw new Error(INVALID_IMAGE_MSG);
          return upload(ready).then((id) => ({ id, name: ready.name }));
        })
        .then(({ id, name }) => {
          ownedImageIds.add(id);
          pastedResults.current.set(uploadId, { src: pastedImageSrc(id), alt: name });
          settleMailImages(editor, pastedResults.current);
        })
        .catch((e) => {
          pastedResults.current.set(uploadId, null);
          settleMailImages(editor, pastedResults.current);
          toast.error(e instanceof Error && e.message === INVALID_IMAGE_MSG ? INVALID_IMAGE_MSG : extractApiError(e, '이미지를 올리지 못했습니다'));
        });
    }
    return true;
  }

  // 이미지를 받지 않는 작성창(imageUpload 없음)이면 false — 붙여넣기는 에디터 기본 동작 그대로다.
  useEffect(() => {
    insertImagesRef.current = insertImages;
  });

  const touch = layout === 'mobile';
  // 표 안 커서 여부 — 모바일 표 막대 고정 줄이 보일지 가른다.
  const caretInTable = useCaretInTable(editor);
  // 모바일 서식 줄 위 자리(서식판·표 격자 패널·표 막대 고정 줄)는 한 번에 하나만 쓴다 — 서식판 > 표 패널 > 표 막대 줄 순으로 우선한다.
  // 서식판 ↔ 표 패널은 서로 닫고, 둘 중 하나가 열려 있으면 표 막대 고정 줄을 감춘다(MailTableToolbar touchRowHidden).
  const mobilePanel: MobilePanel | null = !touch
    ? null
    : formatOpen
      ? 'format'
      : tablePanelOpen
        ? 'table'
        : caretInTable
          ? 'tableRow'
          : null;
  const sheetOpen = mobilePanel === 'format';
  const tableOpen = mobilePanel === 'table';
  // 서식판·표 패널이 열린 동안은 표 막대 고정 줄을 감춘다.
  const touchRowHidden = sheetOpen || tableOpen;
  const openPanelId = mobilePanel && { format: formatRowId, table: tablePanelId, tableRow: MAIL_MOBILE_TABLE_ROW_ID }[mobilePanel];
  // 모바일 서식판·표 패널이 열리면(다른 쪽으로 바뀌어도) 커서를 패널 위로 올린다 — 고른 글자를 보며 서식을 고르게.
  // 본문 아래 빈 자리(PANEL_RESERVE)가 같은 렌더에 깔리므로, 레이아웃이 잡힌 다음 프레임에 잰다.
  // 표 막대 고정 줄이 보이는 동안(모바일 · 커서가 표 안 · 서식판/표 패널이 안 열림)도 같은 방식으로 줄 위로 올린다.
  useEffect(() => {
    if (!editor || !openPanelId) return;
    const raf = requestAnimationFrame(() => bringCaretAbovePanel(editor, openPanelId));
    return () => cancelAnimationFrame(raf);
  }, [editor, openPanelId]);

  if (!editor) return null;

  return (
    <div className={cn('flex flex-col', !touch && 'gap-1.5', layout === 'fill' && 'flex-1')}>
      {/* 두 줄 감싸개 — 크게 보기(fill)에서는 두 줄이 함께 위에 붙는다(sticky 는 여기가 진다). */}
      <div
        data-testid="mail-composer-toolbars"
        className={cn(!touch && 'flex flex-col gap-1.5', layout === 'fill' && 'sticky top-0 z-10 bg-background')}
      >
      <div data-testid="mail-composer-toolbar" className={TOOLBAR_CLASS[layout]}>
        <ToolbarButton
          touch={touch}
          label="굵게"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          touch={touch}
          label="기울임"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          touch={touch}
          label="글머리 목록"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          touch={touch}
          label="번호 목록"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton
          touch={touch}
          label="링크"
          active={editor.isActive('link')}
          onClick={() => {
            // 다이얼로그 열기 — window.prompt 대체 (#148).
            const prev = editor.getAttributes('link').href as string | undefined;
            setLinkUrl(prev ?? '');
            setLinkDialog(true);
          }}
        >
          <Link2 />
        </ToolbarButton>
        {touch && (
          <ToolbarButton
            touch
            label="표 넣기"
            title="표 넣기"
            active={tableOpen}
            expanded={tableOpen}
            controls={tablePanelId}
            onClick={() => {
              // 표 패널을 열면 서식판을 닫는다(같은 자리) — 서식판 닫힘도 기억에 남는다.
              if (!tableOpen && formatOpen) setFormatOpen(false);
              setTablePanelOpen(!tableOpen);
            }}
          >
            <Table2 />
          </ToolbarButton>
        )}
        <ToolbarButton
          touch={touch}
          label="서식"
          title="서식"
          active={formatOpen}
          expanded={formatOpen}
          controls={formatRowId}
          onClick={() => {
            // 서식판을 열면 표 패널을 닫는다(모바일, 같은 자리).
            if (!formatOpen) setTablePanelOpen(false);
            setFormatOpen(!formatOpen);
          }}
        >
          <Type />
        </ToolbarButton>
        {toolbarEnd}
      </div>
      {/* 둘째 줄은 데스크톱(dock·fill)만 — 모바일은 서식 줄 위 서식판(MailFormatSheet)이 같은 펼침 기억으로 맡는다. */}
      {layout !== 'mobile' && formatOpen && <MailFormatRow id={formatRowId} editor={editor} layout={layout} />}
      {/* 모바일 서식판·표 패널 — 화면 고정(fixed)이라 DOM 자리는 상관없다. BubbleMenu 와 다른 부모라 조건부 형제여도 안전하다. */}
      {sheetOpen && <MailFormatSheet id={formatRowId} editor={editor} />}
      {tableOpen && (
        <div
          id={tablePanelId}
          data-testid="mail-table-panel"
          // 칸을 눌러도 본문 초점이 빠지지 않게 — 가상 키보드가 닫히지 않는다.
          onMouseDown={(e) => e.preventDefault()}
          className={MAIL_MOBILE_PANEL_CLASS}
        >
          <MailTableGridPicker
            max={MAIL_TABLE_GRID_MAX.mobile}
            touch
            onPick={(rows, cols) => {
              insertMailTable(editor, rows, cols);
              setTablePanelOpen(false);
            }}
          />
        </div>
      )}
      </div>
      {/* 크게 보기는 본문이 남은 높이를 채우도록 래퍼도 세로 flex 로 늘린다. 겹침 자리의 기준이 되도록 relative. */}
      <div className={cn('relative', layout === 'fill' && 'flex flex-1 flex-col')}>
        {/* 표 막대(WP-1524) — 커서가 표 안이면 데스크톱은 표 위에 뜨고, 모바일은 서식 줄 위 고정 줄. EditorContent 앞에 둔다:
            BubbleMenu 는 마운트 때 자기 DOM 을 떼어 내므로, 그 앞에 조건부 형제가 있으면 언마운트 때 React 가 사라진 앵커에
            insertBefore 를 시도해 작성창이 죽는다(WikiEditor 의 같은 함정 주석). 맨 앞이면 뒤의 조건부 겹침(bodyOverlay)이 안전하다. */}
        <MailTableToolbar editor={editor} touch={touch} touchRowHidden={touchRowHidden} />
        <EditorContent editor={editor} className={layout === 'fill' ? 'flex flex-1 flex-col' : undefined} />
        {bodyOverlay && <div className={OVERLAY_CLASS[layout]}>{bodyOverlay}</div>}
      </div>
      {/* 모바일 패널·표 막대 줄이 보이는 동안 본문 아래 빈 자리 — 패널(최대 --vvh 의 45%)이나 줄이 본문 끝을 덮어도 그 위로 올려 볼 수 있게.
          작성 스크롤 영역의 아래 여백은 서식 줄 몫만 비우므로 패널·줄 몫을 여기서 더한다. */}
      {mobilePanel && (
        <div aria-hidden="true" data-testid={PANEL_RESERVE[mobilePanel].testId} className={PANEL_RESERVE[mobilePanel].className} />
      )}

      {/* 링크 URL 입력 다이얼로그 — window.prompt 대체 (#148) */}
      <LinkUrlDialog
        open={linkDialog}
        url={linkUrl}
        onUrlChange={setLinkUrl}
        onConfirm={confirmLink}
        onCancel={closeLinkDialog}
      />
    </div>
  );

  /** 링크 다이얼로그를 닫고 입력값을 비운다. */
  function closeLinkDialog() {
    setLinkDialog(false);
    setLinkUrl('');
  }

  /** 링크 다이얼로그 확인 — 닫고 지금 입력값으로 링크를 걸거나 푼다(applyLink). */
  function confirmLink() {
    if (!editor) return; // editor 는 JSX 내부에서만 호출되지만 타입 안전을 위해 가드.
    closeLinkDialog();
    applyLink(editor, linkUrl);
  }
},
)
