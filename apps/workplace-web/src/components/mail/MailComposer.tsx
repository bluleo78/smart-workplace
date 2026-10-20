// 메일 본문 리치 텍스트 에디터(Tiptap). 굵게/기울임/목록/링크 최소 툴바.
// 외부엔 getHTML()/getText() 를 onChange 로 흘려보낸다(저장은 상위 도크가 담당).
// chat RichInput 과 분리 — 멘션/suggestion 배선이 없는 독립 인스턴스.

import Link from '@tiptap/extension-link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Link2, List, ListOrdered } from 'lucide-react';
import type { ReactNode } from 'react';
import { forwardRef, useImperativeHandle, useState } from 'react';

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
import { ImeCommitFlush } from '@/lib/imeCommitFlush';
import { ghostToggleClass } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';

/**
 * 에디터 배치 — 작성창 모양에 따라 본문 크기·툴바 위치가 달라진다.
 * - dock: 작은 작성창. 본문 높이 상한(40vh) + 세로 스크롤.
 * - fill: 데스크톱 크게 보기(WP-575). 상한을 풀고 남은 높이를 다 채운다.
 * - mobile: 모바일 화면 전체 작성(WP-583). 테두리 없는 본문, 서식 버튼은 화면 맨 아래(키보드가 열리면 그 바로 위).
 */
export type MailComposerLayout = 'dock' | 'fill' | 'mobile';

interface MailComposerProps {
  /** 초기 HTML(답장/전달 인용문). */
  initialHtml?: string;
  /** 본문 변경 시 HTML+텍스트 동시 전달. initial=true 는 에디터가 처음 만들어질 때(사용자 편집 아님)의 값이다. */
  onChange: (html: string, text: string, initial: boolean) => void;
  /** 작성창 모양에 맞춘 배치. 기본 dock. */
  layout?: MailComposerLayout;
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
 * z-10: 본문(ProseMirror, position:relative)이 DOM 상 뒤에 있어 길게 쓰면 글자가 툴바 위로 그려지므로 올린다.
 * 크게 보기는 에디터가 끝없이 늘고 창 본문이 스크롤되므로 툴바를 위에 붙인다 — 비치지 않게 배경을 깔고 그 위에 같은 옅은 색을 겹친다.
 */
const BOXED_TOOLBAR_CLASS = 'flex items-center gap-0.5 rounded-md border bg-muted/40 p-1';
const TOOLBAR_CLASS: Record<MailComposerLayout, string> = {
  dock: BOXED_TOOLBAR_CLASS,
  fill: cn(BOXED_TOOLBAR_CLASS, 'sticky top-0 z-10 bg-background bg-linear-to-r from-muted/40 to-muted/40'),
  mobile:
    'fixed inset-x-0 bottom-[var(--kb-inset,0px)] z-10 flex items-center gap-1 border-t bg-background px-2 pt-0.5 pb-[max(0.125rem,env(safe-area-inset-bottom))]',
};

/** 툴바 버튼. touch(모바일)는 44px 터치 크기·20px 아이콘, 그 밖엔 작은 버튼·16px 아이콘. */
function ToolbarButton({
  active,
  touch,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  touch: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'rounded text-muted-foreground hover:bg-accent hover:text-foreground',
        touch ? 'flex h-11 w-11 items-center justify-center [&_svg]:size-5' : 'p-1.5 [&_svg]:size-4',
        ghostToggleClass(!!active),
      )}
    >
      {children}
    </button>
  );
}

/** 부모(작성 도크)가 본문을 통째로 교체할 수 있게 노출하는 핸들. */
export interface MailComposerHandle {
  setContent: (html: string) => void
}

/** 메일 본문 작성 에디터. */
export const MailComposer = forwardRef<MailComposerHandle, MailComposerProps>(
  function MailComposer({ initialHtml = '', onChange, layout = 'dock' }, ref) {
  // 링크 URL 입력 다이얼로그 — window.prompt 대체 (#148).
  const [linkDialog, setLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      // macOS Chrome 한글 조합을 끝내는 Enter 가 마지막 글자를 지우지 않게(WP-333).
      ImeCommitFlush,
    ],
    content: initialHtml,
    // 도크가 열리면 "받는사람"으로 포커스를 명시적으로 보낸다(#802) — 에디터가 자동으로
    // 포커스를 가져가면 수신자→제목→본문 순서를 건너뛰게 되므로 여기서는 비활성화.
    autofocus: false,
    // 마운트 직후 refs 를 초기화해 상위 도크가 빈 본문 상태를 정확히 알게 한다.
    // (인용문은 에디터 밖에서 관리되므로 여기 포함되지 않는다 — 설계 §3)
    onCreate: ({ editor }) => onChange(editor.getHTML(), editor.getText(), true),
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.getText(), false),
    editorProps: {
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
      setContent: (html: string) => {
        // Tiptap v2.27 — setContent(content, emitUpdate) 위치 인자. emitUpdate=true 로 onChange 발화 + undo 누적.
        editor?.chain().focus().setContent(html, true).run()
      },
    }),
    [editor],
  )

  if (!editor) return null;
  const touch = layout === 'mobile';

  return (
    <div className={cn('flex flex-col', layout !== 'mobile' && 'gap-1.5', layout === 'fill' && 'flex-1')}>
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
      </div>
      {/* 크게 보기는 본문이 남은 높이를 채우도록 래퍼도 세로 flex 로 늘린다. */}
      <EditorContent editor={editor} className={layout === 'fill' ? 'flex flex-1 flex-col' : undefined} />

      {/* 링크 URL 입력 다이얼로그 — window.prompt 대체 (#148) */}
      <Dialog
        open={linkDialog}
        onOpenChange={(open) => {
          if (!open) {
            setLinkDialog(false);
            setLinkUrl('');
          }
        }}
      >
        <DialogContent data-testid="link-url-dialog">
          <DialogHeader>
            <DialogTitle>링크 삽입</DialogTitle>
            <DialogDescription className="sr-only">링크 삽입</DialogDescription>
          </DialogHeader>
          <Input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
            }}
            placeholder="https://"
            autoFocus
            data-testid="link-url-input"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setLinkDialog(false); setLinkUrl(''); }}
            >
              취소
            </Button>
            <Button onClick={applyLink} data-testid="link-url-confirm">
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  /** 링크 다이얼로그 확인 — 빈 URL 이면 링크 해제, 아니면 링크 설정. */
  function applyLink() {
    if (!editor) return; // editor 는 JSX 내부에서만 호출되지만 타입 안전을 위해 가드.
    setLinkDialog(false);
    setLinkUrl('');
    if (linkUrl.trim() === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl.trim() }).run();
  }
},
)
