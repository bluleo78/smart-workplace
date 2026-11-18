// 답장·전달 컴포저의 인용문 블록. 인용문은 Tiptap 에디터 밖에 있으므로 AI 개선본 교체
// (setContent)의 대상이 되지 않고, 스키마 정규화 손실 없이 원문 서식이 유지된다.
//
// 읽기 전용이다. opacity-50 은 인터랙티브 컨트롤의 의도적 저대비 표현이라 읽으라고 만든
// 영역에 부적합하므로(10-accessibility.md:33), 표면 강등 액자(bg-muted/40) 안에 원본
// "종이"를 넣어 경계를 만든다.
//
// 원문은 신뢰 불가 HTML 이므로 공용 격리 iframe(SandboxedHtmlFrame — sandbox="" + srcDoc)으로만
// 렌더한다. dangerouslySetInnerHTML 금지.
//
// 지난 원문 접기(WP-1747): 여러 번 오간 메일은 원문 블록에 지난 원문까지 길게 보여 바로 앞 원문을 찾기 어렵다.
// 바로 앞 원문만 보이고 지난 원문은 「⋯ 이전 원문 n통」 단추로 펼친다. 보낼 때는 자르기 전 원문 전체
// (draft.quote.html) 가 그대로 간다 — 이 블록은 표시만 한다.

import { ChevronRight, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { SandboxedHtmlFrame } from '@/components/SandboxedHtmlFrame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useInlineMailHtml } from '@/hooks/queries/useMailMessages';
import type { QuoteInlineImage } from '@/lib/mailInlineImages';
import { splitOlderQuotes } from '@/lib/mailQuoteSplit';
import { cn } from '@/lib/utils';

/** 원문 iframe 공통 모양 — 높이만 바로 앞 원문·지난 원문이 다르다. */
const FRAME_CLASS = 'w-full rounded-md border-0 bg-white';

interface MailQuoteBlockProps {
  /** 인용문 raw HTML(언랩 완료). */
  quoteHtml: string;
  /**
   * 요약 줄(summary) 표시용 메타. dateShort 는 1줄 칩용 짧은 표기 — 시각까지 쓰면 발신자 이름이 길 때 넘친다.
   * dateShort 가 빈 문자열이면(sentAt 없음) `· 날짜` 세그먼트를 렌더하지 않는다.
   */
  meta: { from: string; dateShort: string; subject: string };
  /** 요약 줄 모양 — 답장은 1줄 칩, 전달은 메시지 본체라 카드. 둘 다 기본 펼침이다(WP-1746). */
  variant: 'reply' | 'forward';
  /** 인용문 제거 — 기밀 문단을 빼고 회신하는 시나리오. */
  onRemove: () => void;
  /** 인용문 cid 이미지의 원본 첨부 — 미리보기에서 data URI 로 치환해 보여준다(WP-69). */
  inlineImages: QuoteInlineImage[];
}

/**
 * 인용문 표시 블록. 답장·전달 모두 기본 펼침이다 — 원문 머리(보낸 사람·보낸 날짜·받는 사람·참조·제목)와 원문이
 * 그대로 함께 나간다는 것을 쓰는 동안 보이게 한다(WP-1746, Outlook 식). 접기는 사용자가 summary 로 한다.
 */
export function MailQuoteBlock({
  quoteHtml,
  meta,
  variant,
  onRemove,
  inlineImages,
}: MailQuoteBlockProps) {
  // 미리보기 전용 치환 — 발송 본문은 cid: 를 유지하고 서버가 원본 첨부를 인라인 파트로 다시 붙인다.
  const attachments = useMemo(() => inlineImages.map((i) => i.attachment), [inlineImages]);
  // 원본(raw) 원문을 바로 앞 원문·지난 원문으로 먼저 자른다. null 이면 지난 원문이 없어 전체를 그대로 보인다.
  // 치환본(data URI 가 박힌 큰 HTML)을 자르면 이미지가 올 때마다 큰 문자열을 다시 파싱하므로, 자르기는 원문이 바뀔 때만 한다.
  const split = useMemo(() => splitOlderQuotes(quoteHtml), [quoteHtml]);
  // 지난 원문 펼침 — 기본은 접힘. 펼칠 때만 두 번째 iframe 을 마운트해 긴 스레드의 렌더 비용을 아낀다.
  // 어느 원문에 대해 펼쳤는지를 들고 있어, 원문이 바뀌면(다른 메일에 답장 등) 저절로 접힘으로 돌아간다.
  const [olderOpenFor, setOlderOpenFor] = useState<string | null>(null);
  const olderOpen = split !== null && olderOpenFor === quoteHtml;
  // 첫 iframe 에 그릴 원문 — 자른 경우 바로 앞 원문, 아니면 전체.
  const recentHtml = split?.recent ?? quoteHtml;
  // 미리보기 cid 치환은 조각마다 한다. 지난 원문은 펼쳤을 때만 치환·이미지 받기를 한다(접힌 채로는 보이지 않으므로).
  const { html: recentPreview } = useInlineMailHtml(recentHtml, attachments);
  const { html: olderPreview } = useInlineMailHtml(olderOpen ? split.older : null, attachments);
  // 펼친 원문 높이 2단계. 표가 든 원문은 기본 높이에서 거의 보이지 않는다.
  const [tall, setTall] = useState(false);
  // details 의 open 은 React 가 재조정하는 속성이다. open={true} 처럼 고정값으로 두면 사용자가
  // native 토글로 접은 뒤 tall 변경으로 리렌더될 때 React 가 open 을 되돌린다. 상태로 들고 onToggle 로 동기화한다.
  // 처음 값은 답장·전달 모두 펼침(WP-1746 — 이전엔 답장은 접힘).
  const [open, setOpen] = useState(true);
  const frameHeight = tall ? 'h-64' : 'h-40';
  // 지난 원문은 여러 통이 이어져 길다 — 바로 앞 원문보다 한 단계 높게 보인다.
  const olderFrameHeight = tall ? 'h-96' : 'h-64';
  // 지난 원문 단추가 여닫는 영역 — aria-controls 로 이어 보조 기술이 무엇을 펼치는지 알게 한다.
  const olderRegionId = useId();

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
        <SandboxedHtmlFrame
          data-testid="mail-compose-quote-frame"
          title="인용된 원문"
          html={recentPreview ?? recentHtml}
          // 고정 높이로 스스로 스크롤 — 스크롤바 칸이 문서 배경 위에 그려지게 body 가 스크롤을 맡는다(WP-1749).
          scrollingDocument
          className={cn(FRAME_CLASS, frameHeight)}
        />
        {split && (
          <>
            <Button
              type="button"
              variant="link"
              size="xs"
              aria-expanded={olderOpen}
              aria-controls={olderRegionId}
              data-testid="mail-compose-quote-older-toggle"
              onClick={() => setOlderOpenFor(olderOpen ? null : quoteHtml)}
            >
              {olderOpen ? '⋯ 이전 원문 접기' : `⋯ 이전 원문 ${split.count}통`}
            </Button>
            {olderOpen && (
              <div id={olderRegionId}>
                <SandboxedHtmlFrame
                  data-testid="mail-compose-quote-older-frame"
                  title="이전 원문"
                  html={olderPreview ?? split.older}
                  scrollingDocument
                  className={cn(FRAME_CLASS, olderFrameHeight)}
                />
              </div>
            )}
          </>
        )}
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
