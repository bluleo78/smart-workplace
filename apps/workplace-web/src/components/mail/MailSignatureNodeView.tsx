// 작성창 서명 블록 노드뷰(WP-1517) — 서명 HTML 을 격리 iframe 으로 그린다(앱 문서에 innerHTML 로 넣지 않는다, mailSignatureNode 머리 주석).
// - 그리기(우리 스크립트만 iframe·높이 맞춤·서명 이미지 data URI)는 설정 카드의 붙여넣은 서명 미리 보기와 같은 SignatureHtmlFrame 을 쓴다(WP-1726).
// - 다크 테마면 받은 메일 본문처럼 useMailDarkHtml 로 바꿔 그린다. 보내는 HTML 은 노드 속성(원문 색) 그대로다.
// - 프레임 위에 투명 덮개를 둔다 — iframe 이 클릭을 삼키지 않고 ProseMirror 가 노드를 고르게(고른 뒤 Backspace 로 뺀다).
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';

import { useMailDarkHtml } from '@/hooks/useMailDarkHtml';
import { cn } from '@/lib/utils';

import { SIGNATURE_FRAME_STYLE, SignatureHtmlFrame } from './signature/SignatureHtmlFrame';

/** 서명 블록 — 고르면(클릭) 테두리를 보인다. Backspace·Delete 로 뺄 수 있다는 단서. */
export function MailSignatureNodeView({ node, selected }: ReactNodeViewProps) {
  const html = String(node.attrs.html ?? '');
  // 다크 변환을 먼저 한다 — 이미지를 data URI 로 바꾼 뒤엔 문서가 커져 파싱이 무거워진다(useMailDarkHtml 주석과 같은 이유).
  const darkHtml = useMailDarkHtml(SIGNATURE_FRAME_STYLE + html) ?? '';

  return (
    <NodeViewWrapper
      data-testid="mail-signature-block"
      contentEditable={false}
      className={cn('relative my-1 rounded-sm', selected && 'ring-2 ring-ring')}
    >
      <SignatureHtmlFrame html={darkHtml} className="block w-full border-0" />
      {/* 클릭이 iframe 으로 가지 않게 덮는다 — ProseMirror 가 mousedown 을 받아 노드를 고른다. */}
      <div aria-hidden className="absolute inset-0 cursor-default" />
    </NodeViewWrapper>
  );
}
