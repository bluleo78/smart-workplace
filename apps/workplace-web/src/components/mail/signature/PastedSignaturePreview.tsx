// 붙여넣은 서명 「원본 그대로」 미리 보기(WP-1726) — 표·인라인 style·글꼴·클래스 서식이 든 서명을 붙여 넣으면 설정 서명 카드가
// tiptap 편집기(스키마 밖 서식을 지운다) 대신 이 미리 보기를 보여 준다. 원본 HTML 은 서버 정리만 거쳐 저장·작성창·발송에 그대로 쓰인다.
// - 그리기는 작성창 서명 블록과 같은 SignatureHtmlFrame(우리 스크립트만 iframe — 서명 안 스크립트는 돌지 않는다, 높이는 내용에 맞춤).
// - 바탕은 테마와 무관하게 흰색 — 받는 사람이 보는 모습 그대로(다크 변환을 하지 않는다, HTML_DOCUMENT_CANVAS_CLASS 와 같은 이유).
// - 「다시 붙여넣기」는 붙여넣기만 받는 칸을 연다. 「편집기로 바꾸기」는 서식이 빠질 수 있다는 확인을 받는다.
import { type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { HTML_DOCUMENT_CANVAS_CLASS } from '@/lib/sandboxedHtml';
import { cn } from '@/lib/utils';

import { SIGNATURE_FRAME_STYLE, SignatureHtmlFrame } from './SignatureHtmlFrame';

/** 붙여넣기 칸이 받은 클립보드 내용 — html 은 text/html(없으면 ''), text 는 text/plain. */
export interface SignatureClipboard {
  html: string;
  text: string;
}

export interface PastedSignaturePreviewProps {
  /** 그릴 서명 HTML(붙여 넣은 원본을 클래스 서식만 풀어 둔 것, 저장 뒤엔 서버가 정리한 것). */
  html: string;
  /** 「다시 붙여넣기」 칸에 붙여 넣었다 — 무엇으로 바꿀지(미리 보기·편집기)는 카드가 정한다. */
  onRepaste: (data: SignatureClipboard) => void;
  /** 확인 대화상자에서 「바꾸기」를 눌렀다 — 카드가 편집기 모드로 바꾸고 이 HTML 로 편집기를 연다. */
  onSwitchToEditor: () => void;
}

/**
 * 미리 보기 문서 — 작성창 서명과 같은 SIGNATURE_FRAME_STYLE(body 는 스크롤 숨김) 뒤에 내용을 가로 스크롤 칸으로 감싼다.
 * 붙여 넣은 표 서명은 600pt(800px)까지 넓을 수 있어 카드보다 넓으면 가로로 스크롤해야 한다.
 * 왜 body 가 아니라 감싼 칸인가(WP-1726 코드 리뷰): body 가 스크롤하면 가로 스크롤 막대가 창(뷰포트) 안쪽 자리를 차지해 높이 보고
 * (documentElement·body 높이)에 들지 않고, 표 마지막 줄 15px 남짓이 막대 밑에 가린다. 칸이 스크롤하면 막대가 칸 높이에 들어
 * 문서 높이 = 내용 + 막대가 되어 iframe 이 막대까지 담는다. 세로는 높이를 내용에 맞추므로 숨긴다.
 */
function previewDocument(html: string): string {
  return `${SIGNATURE_FRAME_STYLE}<div data-mail-signature-scroll style="overflow-x:auto;overflow-y:hidden">${html}</div>`;
}

/** 붙여넣은 서명 미리 보기 카드 — 머리 문구, 흰 바탕 격리 iframe, 「다시 붙여넣기」·「편집기로 바꾸기」. */
export function PastedSignaturePreview({ html, onRepaste, onSwitchToEditor }: PastedSignaturePreviewProps) {
  const [repasting, setRepasting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div data-testid="mail-signature-pasted" className="flex flex-col gap-2 rounded-md border border-input p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">붙여넣은 서명 · 원본 그대로</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRepasting((v) => !v)}>
            다시 붙여넣기
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            편집기로 바꾸기
          </Button>
        </div>
      </div>

      {repasting && (
        <PasteZone
          onPaste={(data) => {
            setRepasting(false);
            onRepaste(data);
          }}
          onCancel={() => setRepasting(false)}
        />
      )}

      {/* 흰 종이 바탕 — iframe 둘레 여백도 같은 흰색이라 받는 쪽 메일 본문처럼 보인다. */}
      <div className={cn('rounded-sm px-3 py-2', HTML_DOCUMENT_CANVAS_CLASS)}>
        <SignatureHtmlFrame html={previewDocument(html)} className={cn('block w-full border-0', HTML_DOCUMENT_CANVAS_CLASS)} />
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>편집기로 바꿀까요?</AlertDialogTitle>
            <AlertDialogDescription>편집기로 바꾸면 일부 서식이 빠질 수 있어요</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={onSwitchToEditor}>바꾸기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * 붙여넣기만 받는 칸 — 글자를 쳐 넣을 수는 없고(키 입력을 막는다) Ctrl+V·메뉴 붙여넣기만 받는다. 붙여 넣은 내용은 화면에 넣지 않고
 * 클립보드 값을 그대로 넘긴다(contentEditable 의 기본 붙여넣기는 브라우저가 서식을 다시 쓴다). 열리면 바로 포커스를 받는다.
 */
function PasteZone({ onPaste, onCancel }: { onPaste: (data: SignatureClipboard) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    // 이미지만 든 클립보드 등 붙일 글이 없으면 칸을 연 채로 둔다.
    if (!html.trim() && !text.trim()) return;
    onPaste({ html, text });
  };

  // 붙여넣기 단축키(Ctrl·⌘ 조합, Shift+Insert)·Tab(포커스 이동)은 두고, 그 밖의 입력은 막는다. Esc 는 닫기.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.key === 'Tab' || (e.shiftKey && e.key === 'Insert')) return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="textbox"
      aria-label="여기에 서명을 붙여 넣으세요"
      aria-multiline="true"
      tabIndex={0}
      contentEditable
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      onDrop={(e) => e.preventDefault()}
      // 입력기(IME) 조합으로 글자가 들어가는 것도 막는다 — 키 입력 막기를 지나는 유일한 길이다.
      onInput={(e) => {
        e.currentTarget.textContent = '';
      }}
      // 안내 글은 칸 내용이 아니라 ::before 로 그린다 — 칸 안 글자는 onInput 이 늘 비운다.
      data-placeholder="여기에 서명을 붙여 넣으세요 (Ctrl+V)"
      className="min-h-[4rem] rounded-md border border-dashed border-input bg-muted/40 px-3 py-5 text-center text-sm text-muted-foreground empty:before:content-[attr(data-placeholder)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}
