// 메일 본문 이미지 노드뷰(WP-947) — 붙여 넣은 캡처를 본문 폭 안에서 원래 비율로 보여 준다.
// 업로드 경로는 인증이 필요해(메모리 Bearer) <img> 가 직접 받지 못하므로 blob objectURL 로 바꿔 그린다(RichImageNodeView 와 같은 이유).
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { ImageOff } from 'lucide-react';

import { useApiBlobUrl } from '@/hooks/queries/useApiBlobUrl';
import { isPastedImageSrc } from '@/lib/mailPastedImages';

// 그림이 아직 없는 자리(업로드 중·불러오는 중·실패)의 상자.
const BOX = 'inline-flex h-24 w-40 items-center justify-center gap-1 rounded-md border text-xs text-muted-foreground';

export function MailImageNodeView({ node, selected }: ReactNodeViewProps) {
  const src = node.attrs.src ? String(node.attrs.src) : '';
  const alt = node.attrs.alt ? String(node.attrs.alt) : '';
  const pending = Boolean(node.attrs.uploadId);
  // 붙여 넣은 이미지 경로만 인증 요청으로 받는다 — 노드는 parseHTML 이 그 경로만 만들지만, 혹시 오면 요청하지 않는다.
  const pasted = isPastedImageSrc(src);
  const { url, isError: fetchError } = useApiBlobUrl(pasted ? src : null);
  const isError = fetchError || (!pending && !pasted);

  // 인라인 노드라 wrapper 는 span. 선택되면(클릭) 테두리로 표시 — Backspace/Delete 로 지울 수 있다는 단서.
  return (
    <NodeViewWrapper
      as="span"
      className={`my-1 inline-block max-w-full align-bottom ${selected ? 'rounded-md ring-2 ring-ring' : ''}`}
      data-testid="mail-body-image"
      data-pending={pending ? 'true' : undefined}
    >
      {pending ? (
        <span className={`${BOX} bg-muted`}>이미지 올리는 중…</span>
      ) : isError ? (
        <span className={`${BOX} border-dashed`}>
          <ImageOff className="h-3.5 w-3.5" /> 불러올 수 없음
        </span>
      ) : url ? (
        <img src={url} alt={alt} className="block h-auto max-w-full rounded-sm" draggable={false} />
      ) : (
        <span className={`${BOX} animate-pulse bg-muted`} />
      )}
    </NodeViewWrapper>
  );
}
