// 메일 본문 리치 텍스트 에디터(Tiptap). 굵게/기울임/목록/링크 최소 툴바.
// 외부엔 getHTML()/getText() 를 onChange 로 흘려보낸다(저장은 상위 도크가 담당).
// chat RichInput 과 분리 — 멘션/suggestion 배선이 없는 독립 인스턴스.

import Link from '@tiptap/extension-link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Link2, List, ListOrdered } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

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
import { cn } from '@/lib/utils';

interface MailComposerProps {
  /** 초기 HTML(답장/전달 인용문). */
  initialHtml?: string;
  /** 본문 변경 시 HTML+텍스트 동시 전달. */
  onChange: (html: string, text: string) => void;
}

/** 툴바 버튼. */
function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
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
        'rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground',
        active && 'bg-accent text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** 메일 본문 작성 에디터. */
export function MailComposer({ initialHtml = '', onChange }: MailComposerProps) {
  // 링크 URL 입력 다이얼로그 — window.prompt 대체 (#148).
  const [linkDialog, setLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: initialHtml,
    autofocus: 'end',
    // 미편집(타이핑 없음) 답장/전달도 인용 본문이 발송되도록 마운트 직후 refs 를 초기화.
    onCreate: ({ editor }) => onChange(editor.getHTML(), editor.getText()),
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.getText()),
    editorProps: {
      attributes: {
        'data-testid': 'mail-composer-body',
        'aria-label': '메일 본문',
        class:
          'prose prose-sm max-w-none min-h-[180px] overflow-auto rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      },
    },
  });

  if (!editor) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-0.5 rounded-md border bg-muted/40 p-1">
        <ToolbarButton
          label="굵게"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="기울임"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="글머리 목록"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="번호 목록"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="링크"
          active={editor.isActive('link')}
          onClick={() => {
            // 다이얼로그 열기 — window.prompt 대체 (#148).
            const prev = editor.getAttributes('link').href as string | undefined;
            setLinkUrl(prev ?? '');
            setLinkDialog(true);
          }}
        >
          <Link2 className="h-4 w-4" />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />

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
}
