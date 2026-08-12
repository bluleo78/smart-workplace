// 답장·전달 컴포저의 인용문 블록. 인용문은 Tiptap 에디터 밖에 있으므로 AI 개선본 교체
// (setContent)의 대상이 되지 않고, 스키마 정규화 손실 없이 원문 서식이 유지된다.
//
// 읽기 전용이다. opacity-50 은 인터랙티브 컨트롤의 의도적 저대비 표현이라 읽으라고 만든
// 영역에 부적합하므로(10-accessibility.md:33), 표면 강등 액자(bg-muted/40) 안에 원본
// "종이"를 넣어 경계를 만든다.
//
// 원문은 신뢰 불가 HTML 이므로 sandbox="" iframe + srcDoc 으로만 렌더한다
// (프로젝트 관례: MailInboxPage.tsx 등). dangerouslySetInnerHTML 금지.

import { ChevronRight, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MailQuoteBlockProps {
  /** 인용문 raw HTML(언랩 완료). */
  quoteHtml: string;
  /**
   * 접힘 상태 표시용 메타. date 는 blockquote 헤더용 전체 표기,
   * dateShort 는 1줄 칩용 짧은 표기 — 칩에 전체 표기를 쓰면 발신자 이름이 길 때 넘친다.
   * date/dateShort 가 빈 문자열이면(sentAt 없음) `· 날짜` 세그먼트를 렌더하지 않는다.
   */
  meta: { from: string; date: string; dateShort: string; subject: string };
  /** 답장은 맥락이라 1줄·접힘, 전달은 메시지 본체라 카드·펼침. */
  variant: 'reply' | 'forward';
  /** 인용문 제거 — 기밀 문단을 빼고 회신하는 시나리오. */
  onRemove: () => void;
}

/** 인용문 표시 블록. 전달은 무엇을 보내는지 알 수 있어야 하므로 기본 펼침이다. */
export function MailQuoteBlock({ quoteHtml, meta, variant, onRemove }: MailQuoteBlockProps) {
  // 펼친 원문 높이 2단계. 표가 든 원문은 기본 높이에서 거의 보이지 않는다.
  const [tall, setTall] = useState(false);
  // details 의 open 은 React 가 재조정하는 속성이다. open={variant==='forward'} 처럼
  // 파생값으로 두면 사용자가 native 토글로 펼친 뒤 tall 변경으로 리렌더될 때 React 가
  // open 을 프롭 값으로 되돌려 인용문이 접힌다. 상태로 들고 onToggle 로 동기화한다.
  const [open, setOpen] = useState(variant === 'forward');

  return (
    <details
      className="group"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      data-testid="mail-compose-quote"
    >
      <summary
        data-testid="mail-compose-quote-toggle"
        className="flex cursor-pointer list-none items-center gap-1.5 py-1"
      >
        <ChevronRight
          aria-hidden
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        {variant === 'reply' ? (
          <>
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              인용된 원문
            </span>
            <span className="truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {meta.from}
              {meta.dateShort && ` · ${meta.dateShort}`}
            </span>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{meta.subject}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {meta.from}
                {meta.dateShort && ` · ${meta.dateShort}`}
              </span>
            </span>
            <Badge variant="secondary">원문</Badge>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="인용문 제거"
          data-testid="mail-compose-quote-remove"
          className="ml-auto shrink-0"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
        >
          <X aria-hidden />
        </Button>
      </summary>

      <div className="rounded-lg border border-border bg-muted/40 p-1">
        {/* bg-white 는 하드코딩 색이지만 의도적 — iframe 안은 실제 메일 원본 문서이고
            종이 배경은 테마에 따라 바뀌면 안 된다. */}
        <iframe
          data-testid="mail-compose-quote-frame"
          title="인용된 원문"
          sandbox=""
          srcDoc={quoteHtml}
          className={cn('w-full rounded-md border-0 bg-white', tall ? 'h-64' : 'h-40')}
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <p className="text-xs text-muted-foreground">
          원본 서식 그대로 함께 전송됩니다. 이 영역은 편집할 수 없습니다.
        </p>
        <Button
          type="button"
          variant="link"
          size="xs"
          className="ml-auto"
          onClick={() => setTall((v) => !v)}
        >
          {tall ? '기본 높이' : '전체 높이'}
        </Button>
      </div>
    </details>
  );
}
