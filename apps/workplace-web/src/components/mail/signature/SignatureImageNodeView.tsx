// 서명 편집기 이미지 노드뷰(WP-1517) — 저장된 서명 이미지 경로는 인증(메모리 Bearer)이 필요해 <img> 가 직접 받지 못하므로
// blob objectURL 로 바꿔 그리고(MailImageNodeView 와 같은 이유), 붙여 넣은 data:·외부 주소는 그대로 그린다.
// file:·blob:·cid: 처럼 브라우저가 열 수 없는 주소는 「불러올 수 없음」 상자로 보인다 — 저장하면 서버가 빼고 개수를 알려 준다.
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { ImageOff } from 'lucide-react';
import { useState } from 'react';

import { useApiBlobUrl } from '@/hooks/queries/useApiBlobUrl';
import { isSignatureImageSrc } from '@/lib/mailSignature';

// 그림이 아직 없는 자리(불러오는 중·실패)의 상자 — 작성창 본문 이미지(MailImageNodeView)와 같은 모양.
const BOX = 'inline-flex h-16 w-28 items-center justify-center gap-1 rounded-md border text-xs text-muted-foreground';

/** 브라우저가 그대로 열 수 있는 주소 — 붙여 넣은 data: 이미지와 외부 http(s) 이미지. */
function isDirectSrc(src: string): boolean {
  return /^data:image\//i.test(src) || /^https?:\/\//i.test(src);
}

/** 크기 속성(숫자 px) — 서명 로고는 원래 크기로 보여야 해서 width·height 를 그대로 쓰되 편집기 폭을 넘지 않게 한다. */
function sizeAttr(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function SignatureImageNodeView({ node, selected }: ReactNodeViewProps) {
  const src = node.attrs.src ? String(node.attrs.src) : '';
  const alt = node.attrs.alt ? String(node.attrs.alt) : '';
  const own = isSignatureImageSrc(src);
  const { url: blobUrl, isError: fetchError } = useApiBlobUrl(own ? src : null);
  // 외부 이미지가 404 등으로 깨지면 상자로 바꾼다.
  const [directError, setDirectError] = useState(false);
  const direct = !own && isDirectSrc(src);
  const shownSrc = own ? blobUrl : direct ? src : null;
  const isError = own ? fetchError : !direct || directError;

  // 인라인 노드라 wrapper 는 span. 선택되면(클릭) 테두리로 표시 — Backspace/Delete 로 지울 수 있다는 단서.
  return (
    <NodeViewWrapper
      as="span"
      className={`inline-block max-w-full align-bottom ${selected ? 'rounded-sm ring-2 ring-ring' : ''}`}
      data-testid="signature-image"
    >
      {isError ? (
        <span className={`${BOX} border-dashed`}>
          <ImageOff className="h-3.5 w-3.5" /> 불러올 수 없음
        </span>
      ) : shownSrc ? (
        <img
          src={shownSrc}
          alt={alt}
          width={sizeAttr(node.attrs.width)}
          height={sizeAttr(node.attrs.height)}
          className="inline-block h-auto max-w-full"
          draggable={false}
          onError={() => setDirectError(true)}
        />
      ) : (
        <span className={`${BOX} animate-pulse bg-muted`} />
      )}
    </NodeViewWrapper>
  );
}
