// 메일 서명 편집기(WP-1517) — 설정 › 메일 계정 「서명」 카드의 서식 있는 입력칸.
// Outlook 에서 복사한 서명을 붙여 넣으면 글꼴·색·로고 이미지·링크를 그대로 남긴다(signatureEditorExtensions).
// 작성창(MailComposer)과 같은 툴바 모양·링크 대화상자를 쓰고, 이미지는 파일 선택·이미지만 붙여넣기로 data: URI 를 넣는다 —
// 저장(PUT)하면 서버가 data: 를 받아 서명 이미지로 저장하고 src 를 서명 이미지 경로로 바꾼다.
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import { Bold, ImagePlus, Italic, Link2, Underline as UnderlineIcon } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { toast } from 'sonner';

import { blobToDataUri } from '@/api/blobContent';
import { filesFromPaste } from '@/lib/clipboardFiles';
import { ACCEPTED_IMAGE_TYPES } from '@/lib/imageUpload';

import { LinkUrlDialog, ToolbarButton } from '../MailComposer';
import { applyLink } from '../mailEditorLink';
import { signatureEditorExtensions } from './signatureEditorExtensions';

/** 서명 이미지 한 장 상한 — 서버 MailSignatureImageStore 의 512KB 와 같다(넘으면 서버가 빼므로 미리 알린다). */
const MAX_SIGNATURE_IMAGE_BYTES = 512 * 1024;
const IMAGE_TOO_BIG_MSG = '이미지는 512KB까지 넣을 수 있어요';
const IMAGE_TYPE_MSG = 'PNG·JPEG·GIF·WebP 이미지만 넣을 수 있어요';

/**
 * 본문 칸 클래스 — 작성창 BOXED_EDITOR_CLASS(MailComposer)와 같은 테두리·여백. 서명은 짧아 최소 높이만 둔다.
 * 블록 요소 기본 스타일은 index.css 의 .ProseMirror 규칙을 따른다.
 */
const EDITOR_CLASS =
  'min-h-[8rem] overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** 편집기 내용 → 저장 값. 글자도 이미지도 없으면(빈 문단만) '' — 서버의 「빈 서명」과 같은 표현. */
function editorValue(editor: Editor): string {
  return editor.isEmpty ? '' : editor.getHTML();
}

export interface MailSignatureEditorProps {
  /** 처음 내용 — 마운트할 때 한 번만 쓴다. 그 뒤 갈아 끼우기는 손잡이의 reset 으로 한다. */
  initialHtml: string;
  /**
   * 내용이 바뀔 때 저장 값(빈 서명은 '')을 알린다. initial=true 는 처음 내용·reset 으로 갈아 끼운 직후의 값이다 —
   * 서버 HTML 과 편집기 출력은 글자 단위로 다를 수 있으므로(속성 순서·빈 태그) 「바뀜」 판정의 기준은 이 값으로 잡는다.
   */
  onChange: (html: string, initial: boolean) => void;
}

/** 카드가 쓰는 손잡이. */
export interface MailSignatureEditorHandle {
  /** 「비우기」 — 비운 것도 사용자 편집이라 onChange(…, false) 로 알린다. */
  clear: () => void;
  /** 내용을 html 로 갈아 끼운다(저장 응답의 정리된 HTML). 히스토리에 남기지 않고, 바로 onChange(…, true) 로 새 기준을 알린다. */
  reset: (html: string) => void;
}

/** 서식 있는 서명 입력칸 — 툴바(굵게·기울임·밑줄·링크·이미지)와 본문. */
export const MailSignatureEditor = forwardRef<MailSignatureEditorHandle, MailSignatureEditorProps>(
  function MailSignatureEditor({ initialHtml, onChange }, ref) {
    const [linkDialog, setLinkDialog] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    // editorProps·onUpdate 는 에디터를 만들 때 한 번 정해지므로 최신 콜백을 ref 로 넘긴다.
    const onChangeRef = useRef(onChange);
    const insertImagesRef = useRef<(files: File[]) => void>(() => {});

    const editor = useEditor({
      extensions: signatureEditorExtensions,
      content: initialHtml,
      onCreate: ({ editor }) => onChangeRef.current(editorValue(editor), true),
      onUpdate: ({ editor }) => onChangeRef.current(editorValue(editor), false),
      editorProps: {
        // 이미지만 붙여 넣으면(화면 캡처·이미지 복사) data: 로 넣는다. 글이 함께 오면(Outlook·워드 복사) 글 붙여넣기가 우선이다 —
        // 그런 앱은 선택 영역을 그린 PNG 를 함께 싣기도 해서, 파일을 우선하면 서명 전체가 그림 한 장으로 들어간다(filesFromPaste).
        handlePaste: (_view, event) => {
          const images = filesFromPaste(event.clipboardData).filter((f) => f.type.startsWith('image/'));
          if (images.length === 0) return false;
          insertImagesRef.current(images);
          return true;
        },
        attributes: {
          'data-testid': 'mail-signature-editor',
          'aria-label': '서명',
          class: EDITOR_CLASS,
        },
      },
    });

    useEffect(() => {
      onChangeRef.current = onChange;
      insertImagesRef.current = insertImages;
    });

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          editor?.chain().clearContent(true).run();
        },
        reset: (html: string) => {
          if (!editor) return;
          editor.chain().setContent(html, false).setMeta('addToHistory', false).run();
          onChangeRef.current(editorValue(editor), true);
        },
      }),
      [editor],
    );

    /** 이미지 파일을 커서 자리에 data: 로 넣는다 — 형식·크기가 맞지 않는 파일은 알리고 건너뛴다. */
    function insertImages(files: File[]) {
      if (!editor) return;
      for (const file of files) {
        if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
          toast.error(IMAGE_TYPE_MSG);
          continue;
        }
        if (file.size > MAX_SIGNATURE_IMAGE_BYTES) {
          toast.error(IMAGE_TOO_BIG_MSG);
          continue;
        }
        blobToDataUri(file)
          .then((src) => editor.chain().focus().setImage({ src, alt: file.name }).run())
          .catch(() => toast.error('이미지를 읽지 못했어요'));
      }
    }

    /** 링크 대화상자를 닫고 입력값을 비운다. */
    function closeLinkDialog() {
      setLinkDialog(false);
      setLinkUrl('');
    }

    /** 링크 대화상자 확인 — 닫고 작성창과 같은 규칙(applyLink)으로 링크를 걸거나 푼다. */
    function confirmLink() {
      if (!editor) return;
      closeLinkDialog();
      applyLink(editor, linkUrl);
    }

    if (!editor) return null;

    return (
      <div className="flex flex-col gap-1.5">
        <div data-testid="mail-signature-toolbar" className="flex items-center gap-0.5 rounded-md border bg-muted/40 p-1">
          <ToolbarButton label="굵게" title="굵게" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold />
          </ToolbarButton>
          <ToolbarButton label="기울임" title="기울임" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic />
          </ToolbarButton>
          <ToolbarButton
            label="밑줄"
            title="밑줄"
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon />
          </ToolbarButton>
          <ToolbarButton
            label="링크"
            title="링크"
            active={editor.isActive('link')}
            onClick={() => {
              setLinkUrl((editor.getAttributes('link').href as string | undefined) ?? '');
              setLinkDialog(true);
            }}
          >
            <Link2 />
          </ToolbarButton>
          <ToolbarButton label="이미지" title="이미지" onClick={() => fileInputRef.current?.click()}>
            <ImagePlus />
          </ToolbarButton>
          <input
            ref={fileInputRef}
            type="file"
            accept={[...ACCEPTED_IMAGE_TYPES].join(',')}
            className="hidden"
            data-testid="mail-signature-image-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // 같은 파일을 다시 골라도 change 가 나게 비운다.
              e.target.value = '';
              insertImages(files);
            }}
          />
        </div>
        <EditorContent editor={editor} />

        {/* 링크 주소 입력 — 작성창과 같은 대화상자 */}
        <LinkUrlDialog
          open={linkDialog}
          url={linkUrl}
          onUrlChange={setLinkUrl}
          onConfirm={confirmLink}
          onCancel={closeLinkDialog}
          testId="signature-link-dialog"
        />
      </div>
    );
  },
);
