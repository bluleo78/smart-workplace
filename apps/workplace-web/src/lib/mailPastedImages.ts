// 메일 본문에 붙여 넣은 이미지(WP-947) — 편집·임시저장 동안은 작성창 업로드 파일 경로(`/api/v1/files/{id}/content`)로 두고,
// 보낼 때만 `cid:` 로 바꿔 서버가 같은 Content-ID 의 인라인 파트로 붙이게 한다(받는 메일 앱 본문에 그림이 보이게).
// 업로드 자체는 일반 첨부와 같은 작성창 업로드라, 보관·발송 뒤 만료는 attachmentIds 를 따라간다 — 그래서 본문이 참조하는 업로드 id 는
// 임시저장·발송의 attachmentIds 에도 싣고, 칩으로는 보이지 않게 거른다.

import type { DownscaleOptions } from './imageDownscale';
import { type ComposeAttachment, sendAttachmentIds } from './mailComposeAttachments';

/**
 * 붙여 넣은 이미지를 올리기 전 줄이는 한도 — 인라인 이미지는 MIME 안에 들어가 공급자 상한을 함께 쓴다(Graph 합계 2MB·SMTP 10MB,
 * 서버 MailComposeService.MAX_INLINE_TOTAL_*). 캡처 서너 장이 Graph 한도에 들도록 긴 변 1920px·한 장 512KB 를 넘으면 줄이고,
 * 글자가 선명한 PNG 를 먼저 쓰되 그래도 크면 JPEG 로 바꾼다. BMP(그림판 복사)는 메일이 받지 않아 늘 바꾼다.
 */
export const PASTED_IMAGE_DOWNSCALE: DownscaleOptions = {
  maxEdge: 1920,
  triggerBytes: 512 * 1024,
  convertTypes: new Set(['image/bmp']),
  preferPng: true,
};

/** 붙여 넣은 이미지 src 형식 — 작성창 업로드(file.id)의 내용 경로. 아래 정규식은 모두 이 한 곳에서 만든다. */
const PASTED_PATH = String.raw`/api/v1/files/(\d+)/content`;
/** 편집기는 이 형식의 <img> 만 받는다. */
const PASTED_SRC = new RegExp(`^${PASTED_PATH}$`);
/** Tiptap getHTML() 이 내는 <img> 의 src(큰따옴표)에서 붙여 넣은 이미지 경로만 찾는다 — 1: 앞부분, 2: id, 3: 닫는 따옴표. */
const PASTED_IMG_SRC_ATTR = new RegExp(`(<img\\b[^>]*?\\ssrc=")${PASTED_PATH}(")`, 'g');

/** 업로드 id → 본문 src. */
export function pastedImageSrc(id: number): string {
  return `/api/v1/files/${id}/content`;
}

/** src 가 붙여 넣은 이미지 경로인가 — 다른 <img>(웹 페이지에서 섞여 온 외부 주소 등)는 편집기가 버린다. */
export function isPastedImageSrc(src: string | null | undefined): boolean {
  return src != null && PASTED_SRC.test(src);
}

/** 보낼 때 쓰는 Content-ID — 서버 허용 문자(출력 가능 ASCII, 공백·꺾쇠·따옴표 제외) 안에서 업로드마다 다르게. */
export function pastedContentId(id: number): string {
  return `pasted-${id}@genia-works`;
}

/** 본문이 참조하는 붙여 넣은 이미지의 업로드 id(처음 나온 순서, 중복 없음). */
export function pastedImageIds(html: string): number[] {
  const ids: number[] = [];
  for (const m of html.matchAll(PASTED_IMG_SRC_ATTR)) {
    const id = Number(m[2]);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * 발송 본문 — 붙여 넣은 이미지 src 를 `cid:` 로 바꾸고, 서버에 알릴 인라인 업로드 목록을 함께 돌려준다.
 * 업로드 id 는 attachmentIds 에도 실어야 서버가 클레임·소비한다(호출처가 합친다).
 */
export function toSendablePastedImages(html: string): {
  html: string;
  inlineUploads: { attachmentId: number; contentId: string }[];
} {
  const ids = pastedImageIds(html);
  return {
    html: html.replace(PASTED_IMG_SRC_ATTR, (_all, head: string, id: string, tail: string) =>
      `${head}cid:${pastedContentId(Number(id))}${tail}`,
    ),
    inlineUploads: ids.map((id) => ({ attachmentId: id, contentId: pastedContentId(id) })),
  };
}

/**
 * 임시저장·발송 요청의 첨부 id — 칩(sendAttachmentIds)에 본문이 참조하는 붙여 넣은 이미지 업로드를 겹치지 않게 더한다.
 * 같은 id 가 두 번 가면 서버가 요청 전체를 거절하고, 빠지면 그 업로드가 묶이지 않아 그림이 깨진다.
 */
export function uploadIdsWithBodyImages(
  items: ComposeAttachment[],
  bodyHtml: string,
): { attachmentIds: number[]; forwardAttachmentIds: number[] } {
  const ids = sendAttachmentIds(items);
  const extra = pastedImageIds(bodyHtml).filter((id) => !ids.attachmentIds.includes(id));
  return { ...ids, attachmentIds: [...ids.attachmentIds, ...extra] };
}

/**
 * 붙여넣은 HTML 에서 이 작성창 것이 아닌 본문 이미지를 뺀다 — 다른 임시저장의 그림을 복사해 오면 그 업로드가 이 임시저장으로 옮겨 묶여,
 * 원래 임시저장의 그림이 만료되거나 저장이 거절된다. 같은 작성창 안에서 옮기는 그림(owned)은 그대로 둔다.
 */
export function dropForeignPastedImages(html: string, owned: ReadonlySet<number>): string {
  return html.replace(/<img\b[^>]*>/g, (tag) => (pastedImageIds(tag).some((id) => !owned.has(id)) ? '' : tag));
}
