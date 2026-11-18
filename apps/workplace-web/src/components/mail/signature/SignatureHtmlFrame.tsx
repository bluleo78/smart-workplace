// 서명 HTML 격리 iframe(WP-1517 → WP-1726 에서 꺼냄) — 작성창 서명 블록(MailSignatureNodeView)과 설정 서명 카드의
// 「붙여넣은 서명 · 원본 그대로」 미리 보기(PastedSignaturePreview)가 같은 그리기 경로를 쓰게 한 곳에 둔다.
// - 「우리 스크립트만」 iframe(allowScripts + pageScripts=false): 높이 보고 스크립트만 돌고, 서명 안 스크립트·onerror 같은 인라인 이벤트는 CSP 로 막힌다.
//   불투명 출처라 돌더라도 앱 쿠키·저장소·화면에 닿지 못한다. 높이는 노트 HTML 블록처럼 그 보고를 받아 내용에 맞춘다.
// - 서명 이미지(/api/v1/mail/signature/images/{id})는 인증이 필요하고 iframe 은 부모의 blob: 을 읽지 못해 data URI 로 바꿔 넣는다.
import { useQueries } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { fetchSignatureImageDataUri } from '@/api/mailSignature';
import { COMPOSER_PREVIEW_STYLE } from '@/lib/composerPreviewHtml';
import { replaceSignatureImageSrcs, signatureImageIds, signatureImageSrc } from '@/lib/mailSignature';

import { SandboxedHtmlFrame } from '../../SandboxedHtmlFrame';
import { HTML_EMBED_HEIGHT_SCRIPT, watchEmbedHeight } from '../../wiki/wikiHtmlEmbedFrame';

/** 받기 전·받지 못한 서명 이미지 자리 — 투명한 1×1 GIF. 서명 <img> 의 width·height 가 자리를 지켜 받은 뒤 덜 흔들린다. */
const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** 높이 보고 전 높이(px) — 두 줄 남짓. */
const INITIAL_HEIGHT = 40;
/** 높이 하한(px) — 한 줄 서명도 잘리지 않을 만큼. 노트 블록 하한(80px)은 서명엔 커서 아래가 빈다. */
const MIN_HEIGHT = 20;

/**
 * 서명 문서 앞에 붙이는 스타일 — 작성 에디터와 같은 글자·문단 규칙(COMPOSER_PREVIEW_STYLE)에서 안쪽 여백만 뺀다
 * (서명은 에디터 본문·카드 안에 놓여 이미 여백이 있다). 스크롤은 숨긴다 — 높이를 내용에 맞추므로 상한(1200px)을 넘는 일은 없다.
 * 작성창 서명 블록은 클릭을 막는 덮개가 있어 스크롤할 수 없으므로 여기서 가로 스크롤을 열지 않는다(설정 미리 보기만 따로 연다).
 */
export const SIGNATURE_FRAME_STYLE = `${COMPOSER_PREVIEW_STYLE}<style data-mail-signature-frame>body{padding:0;overflow:hidden}</style>`;

/** 서명 이미지 id → data URI 쿼리 키. 같은 서명을 다시 열어도 다시 받지 않는다(이미지 파일은 바뀌지 않는다 — 새 서명은 새 id). */
const imageDataKey = (id: number) => ['mail', 'signature', 'image-data', id] as const;

/**
 * 서명 HTML 의 서명 이미지 src 를 data URI 로 바꾼 미리보기 HTML. 다 받기 전에는 모두 빈 그림으로 둔다 —
 * 하나씩 바뀔 때마다 iframe 이 새로 만들어지지 않게. 받지 못한 이미지도 빈 그림이다.
 */
function useSignaturePreviewHtml(html: string): string {
  // 노드뷰는 편집(키 입력)마다 다시 그려진다 — 서명 html 이 그대로면 정규식으로 id 를 다시 찾지 않는다.
  const ids = useMemo(() => signatureImageIds(html), [html]);
  // combine 결과는 구조 공유(replaceEqualDeep)라 받은 값이 그대로면 참조가 유지돼 아래 memo 의존값으로 쓸 수 있다.
  const { settled, uris } = useQueries({
    queries: ids.map((id) => ({
      queryKey: imageDataKey(id),
      queryFn: () => fetchSignatureImageDataUri(signatureImageSrc(id)),
      staleTime: Infinity,
      retry: false,
    })),
    combine: summarizeImageResults,
  });
  return useMemo(() => {
    if (ids.length === 0) return html;
    return replaceSignatureImageSrcs(html, new Map(ids.map((id, i) => [id, (settled && uris[i]) || BLANK_IMAGE])));
  }, [html, ids, settled, uris]);
}

/** 서명 이미지 쿼리들 → 다 받았는가(settled)와 받은 data URI 목록(받지 못한 것은 undefined) — 미리보기 memo 의 의존값. */
function summarizeImageResults(rs: { data?: string; isPending: boolean }[]) {
  return { settled: rs.every((r) => !r.isPending), uris: rs.map((r) => r.data) };
}

/**
 * 서명 HTML 을 격리 iframe 으로 그린다. html 은 문서 그대로(스타일 머리말·다크 변환은 호출부가 붙인다) — 이 컴포넌트는
 * 서명 이미지를 data URI 로 바꾸고 높이를 내용에 맞추기만 한다.
 */
export function SignatureHtmlFrame({ html, className }: { html: string; className?: string }) {
  const frameHtml = useSignaturePreviewHtml(html);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  // 문서가 바뀌어 iframe 이 새로 붙으면 그 창을 다시 등록한다(React 19 콜백 ref 정리 함수로 앞 등록을 푼다).
  const frameRef = useCallback((el: HTMLIFrameElement | null) => {
    const win = el?.contentWindow;
    if (!win) return undefined;
    return watchEmbedHeight(win, setHeight, MIN_HEIGHT);
  }, []);

  return (
    <SandboxedHtmlFrame
      ref={frameRef}
      title="서명"
      html={frameHtml}
      allowScripts
      pageScripts={false}
      ownScript={HTML_EMBED_HEIGHT_SCRIPT}
      tabIndex={-1}
      className={className}
      style={{ height }}
    />
  );
}
