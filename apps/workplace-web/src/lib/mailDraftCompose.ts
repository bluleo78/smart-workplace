// 메일 임시저장(WP-577) ↔ 작성창 변환 — 순수 함수만 두어 vitest 로 규칙을 고정한다.
// - 작성창 값 → 저장 요청(buildDraftSavePayload): 본문은 에디터 HTML 만(인용문 제외), 첨부는 올라간 것만.
// - 임시저장 상세 → 작성창 초기값(composeFromDraft): 인용문은 원본 메일로 다시 만들고, 지웠으면 붙이지 않는다.

import type { ComposeDraft } from '@/components/mail/MailComposeContext';
import { type ComposeAttachment, sendAttachmentIds } from '@/lib/mailComposeAttachments';
import type { QuoteInlineImage } from '@/lib/mailInlineImages';
import { pastedImageIds, pastedInlineUploads, restorePastedImageSrcs, uploadIdsWithBodyImages } from '@/lib/mailPastedImages';
import { buildQuote, type MailQuote } from '@/lib/mailQuote';
import { parseAddressList, parseRecipientInput, recipientShortName } from '@/lib/mailRecipients';
import { htmlToPlainText } from '@/lib/mailSignature';
import type { MailDraftDetail, MailDraftSaveRequest } from '@/types/mailDraft';
import type { EmailMessageDetail } from '@/types/mailMessage';

/** 저장 요청에 싣는 본문 평문 길이(코드포인트) — 서버는 앞 120자 미리보기만 만드므로 본문 전체를 매번 보내지 않는다. */
export const DRAFT_PREVIEW_SOURCE_CHARS = 1000;

/** 목록 미리보기 길이(코드포인트) — 서버 MailDraftService.PREVIEW_MAX 와 같다. */
const DRAFT_PREVIEW_CHARS = 120;

/**
 * 저장 요청의 본문 평문 — 공백을 한 칸으로 줄이고 앞 1000자만. 서버가 같은 규칙(공백 정리 → 앞 120자)으로 미리보기를 만들므로
 * 결과 미리보기는 본문 전체를 보낼 때와 같다. 줄이기 전에 넉넉히 잘라 큰 본문에서도 저장마다 전체를 훑지 않는다.
 */
export function draftPreviewSource(text: string): string {
  // 잘린 끝이 서로게이트 쌍의 앞 절반이면 버린다(깨진 글자를 보내지 않게).
  const head = text.slice(0, DRAFT_PREVIEW_SOURCE_CHARS * 4).replace(/[\uD800-\uDBFF]$/, '');
  return Array.from(head.replace(/\s+/g, ' ').trim()).slice(0, DRAFT_PREVIEW_SOURCE_CHARS).join('');
}

/** 저장한 본문 평문(draftPreviewSource 결과) → 목록 미리보기 — 서버가 만드는 값과 같다(저장 뒤 목록 행을 그 자리에서 고칠 때). */
export function draftPreview(sentText: string): string {
  return Array.from(sentText).slice(0, DRAFT_PREVIEW_CHARS).join('');
}

/** 저장 요청을 만들 작성창 값 — 받는사람 칸들은 입력 문자열 그대로. */
export interface DraftComposeValues {
  draft: Pick<ComposeDraft, 'accountId' | 'mode' | 'sourceMessageId'> & { inReplyToMessageId?: number | null };
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  /** 에디터 본문 HTML — 인용문을 넣지 않는다(다시 열 때 sourceMessageId 로 다시 만들므로 넣으면 두 번 붙는다). */
  bodyHtml: string;
  /** 에디터 본문 평문 — 서버가 목록 미리보기만 만든다. */
  bodyText: string;
  quoteRemoved: boolean;
  /** 인용문의 cid 이미지(WP-69) — 자동 저장도 보내기 요청과 같은 inlineImages 를 담는다(WP-1786). 인용문을 지웠으면 싣지 않는다. */
  quoteInlineImages?: QuoteInlineImage[];
  attachments: ComposeAttachment[];
}

/**
 * 작성창 값 → 저장 요청. 올리는 중·실패한 첨부는 싣지 않는다(완료된 것만 — 다시 열었을 때 없는 파일 칩이 생기지 않게).
 * version 은 저장 순서를 아는 자동 저장 훅이 붙인다.
 */
export function buildDraftSavePayload(v: DraftComposeValues): MailDraftSaveRequest {
  return {
    accountId: v.draft.accountId,
    mode: v.draft.mode,
    to: parseRecipientInput(v.to),
    cc: parseRecipientInput(v.cc),
    bcc: parseRecipientInput(v.bcc),
    subject: v.subject,
    bodyHtml: v.bodyHtml,
    bodyText: draftPreviewSource(v.bodyText),
    sourceMessageId: v.draft.sourceMessageId ?? null,
    quoteRemoved: v.quoteRemoved,
    // 발송 요청과 같은 나눔(올린 파일 / 전달 원본) — 올리는 중·실패한 칩은 빠진다. 본문에 붙여 넣은 이미지(WP-947)도 업로드라 함께 묶는다 —
    // 묶지 않으면 서버가 24시간 뒤 지워, 다시 연 임시저장의 그림이 깨진다.
    ...uploadIdsWithBodyImages(v.attachments, v.bodyHtml),
    // WP-1786 — 보내기 요청과 같은 이미지 참조·답장 대상을 함께 담는다(대기열이 행만으로 보내고, 되돌리면 그 행으로 다시 연다).
    // 본문은 업로드 경로 그대로라 inlineUploads 는 참조만 알린다(cid 로 바꾸는 것은 보낼 때뿐).
    inlineImages: v.quoteRemoved
      ? []
      : (v.quoteInlineImages ?? []).map(({ attachment, contentId }) => ({ attachmentId: attachment.id, contentId })),
    inlineUploads: pastedInlineUploads(v.bodyHtml),
    inReplyToMessageId: v.draft.inReplyToMessageId ?? null,
  };
}

/**
 * 임시저장 첨부 → 작성창 완료 칩. 전달 원본 칩 key 는 전달로 열 때와 같은 forward-{id}, 올린 파일은
 * draft-upload-{id} — 작성창이 새로 올리는 칩(upload-{순번})과 겹치지 않게 접두를 달리한다.
 */
function draftAttachmentChips(d: MailDraftDetail): ComposeAttachment[] {
  return d.attachments.map((a) => ({
    key: a.source === 'forward' ? `forward-${a.id}` : `draft-upload-${a.id}`,
    name: a.name,
    size: a.size,
    mimeType: a.mimeType,
    status: 'done',
    progress: 100,
    source: a.source,
    id: a.id,
  }));
}

/**
 * 임시저장 상세 → 저장 요청 — 목록에서 지운 임시저장을 「되돌리기」로 다시 만들 때.
 * 상세에는 본문 평문이 없어 목록 행의 미리보기(서버가 만든 앞 120자)를 그대로 넘긴다 — 되살린 행의 미리보기가 지우기 전과 같다.
 * 지운 임시저장의 업로드는 서버가 24시간 임시로 풀어 두므로 같은 id 로 다시 묶을 수 있다.
 */
export function savePayloadFromDetail(d: MailDraftDetail, preview: string): MailDraftSaveRequest {
  return {
    accountId: d.accountId,
    mode: d.mode,
    to: d.to,
    cc: d.cc,
    bcc: d.bcc,
    subject: d.subject,
    bodyHtml: d.bodyHtml,
    bodyText: preview,
    sourceMessageId: d.sourceMessageId,
    quoteRemoved: d.quoteRemoved,
    // 작성창 칩과 같은 나눔 규칙(sendAttachmentIds) — 상세 첨부는 모두 올라간 것이다.
    ...sendAttachmentIds(draftAttachmentChips(d)),
    inlineImages: d.inlineImages ?? [],
    inlineUploads: d.inlineUploads ?? [],
    inReplyToMessageId: d.inReplyToMessageId ?? null,
  };
}

/** 보내기 요청 본문에서 인용문이 시작하는 표시 — buildQuote 의 감싸기와 같다. 편집기는 class 를 남기지 않아 쓴 본문에는 나오지 않는다. */
const SENT_QUOTE_START = '<div class="wp_quote gmail_quote">';

/** 보내기 요청 형태로 바뀐 붙여 넣은 이미지 src — pastedContentId 의 모양(pasted-{id}@genia-works). */
const SENT_PASTED_SRC = /"cid:pasted-\d+@genia-works"/;

/**
 * 본문이 보내기 요청 형태인가(WP-1786) — 되돌린 행은 send_state 가 비어 표시가 없으므로 본문으로 알아본다. 쓰기 창 형태 본문에는
 * 인용 표시(편집기는 class 를 남기지 않는다)도 cid 붙여 넣은 이미지(편집 중엔 업로드 경로다)도 나오지 않는다.
 */
function looksSent(bodyHtml: string): boolean {
  return bodyHtml.includes(SENT_QUOTE_START) || SENT_PASTED_SRC.test(bodyHtml);
}

/**
 * 보내기 요청 형태 본문을 쓰기 창 형태로 나눈다(WP-1786) — 붙여 넣은 이미지 cid 를 업로드 경로로 되돌리고, 맨 뒤에 붙은 인용문을 뗀다.
 * 처음 나오는 인용 표시부터가 내가 붙인 인용문이다(그 안에 원문의 지난 인용이 또 있을 수 있어 처음 것으로 자른다).
 */
function splitSentBody(d: MailDraftDetail): { bodyHtml: string; quoteHtml: string | null } {
  const html = restorePastedImageSrcs(d.bodyHtml, d.inlineUploads ?? []);
  const at = html.indexOf(SENT_QUOTE_START);
  if (at < 0) return { bodyHtml: html, quoteHtml: null };
  return { bodyHtml: html.slice(0, at), quoteHtml: html.slice(at) };
}

/**
 * 원본 메일을 받지 못할 때(원본이 지워졌거나 받기에 실패 — 대기 행도 sourceMessageId 를 남기지만 그 원본이 없을 수 있다) 떼어 낸 인용문으로 인용 블록을 만든다. 보낼 때와 같은 HTML·cid 참조를 그대로 잇는다.
 * 미리보기는 cid 참조만 알고 원본 첨부 메타가 없어 최소 메타(이미지·크기 0)로 채운다 — 서버 다시 붙이기에는 attachmentId·contentId 만 쓰인다.
 */
function quoteFromSent(d: MailDraftDetail, quoteHtml: string): MailQuote {
  const inlineImages: QuoteInlineImage[] = (d.inlineImages ?? []).map(({ attachmentId, contentId }) => ({
    contentId,
    attachment: { id: attachmentId, filename: null, contentType: 'image/*', sizeBytes: 0, contentId },
  }));
  return {
    html: quoteHtml,
    text: htmlToPlainText(quoteHtml).trim(),
    meta: { from: '', dateShort: '', subject: d.subject },
    variant: d.mode === 'reply' ? 'reply' : 'forward',
    inlineImages,
  };
}

/**
 * 임시저장 상세 → 작성창 초기값. source 는 답장·전달 원본 상세(인용문을 지웠거나 받지 못했으면 null).
 * 첨부는 이미 올라간 것이라 완료 칩으로 넣는다(draftAttachmentChips).
 */
export function composeFromDraft(
  d: MailDraftDetail,
  source: EmailMessageDetail | null,
  opts: { sent?: boolean } = {},
): ComposeDraft {
  // 보내기 요청 형태(WP-1786) — 되돌리기로 돌려받은 상세(sent), 보내기 상태가 남은 행(FAILED 등), 또는 되돌린 뒤 쓰기 형태로 다시 저장되지 못한 행
  // (cancel-send 가 send_state 를 비워 표시가 없다 — 본문으로 알아본다). 본문 뒤 인용문을 떼어 내고 이미지를 되돌린다.
  // 인용문이 없으면 지우고 보낸 것이다(서버가 남긴 quoteRemoved 도 따른다) — 원본이 있어도 되살리지 않는다.
  const sentForm = !!opts.sent || d.sendState != null || looksSent(d.bodyHtml);
  const split = sentForm ? splitSentBody(d) : { bodyHtml: d.bodyHtml, quoteHtml: null };
  const quoteRemoved = sentForm ? split.quoteHtml == null || d.quoteRemoved : d.quoteRemoved;
  const variant = d.mode === 'forward' ? 'forward' : 'reply';
  // 원본이 있으면 늘 원본으로 다시 만든다(보낼 때도 같은 함수가 만들었다). 보내기 형태인데 원본이 없으면 떼어 낸 인용문을 그대로 쓴다.
  const quote = quoteRemoved
    ? null
    : source
      ? buildQuote(source, variant)
      : split.quoteHtml != null
        ? quoteFromSent(d, split.quoteHtml)
        : null;
  // 본문에 붙여 넣은 이미지(WP-947)는 업로드로 묶여 있지만 칩이 아니라 본문에 보인다 — 칩에서 뺀다(저장할 때 본문에서 다시 모은다).
  const inBody = pastedImageIds(split.bodyHtml);
  const attachments = draftAttachmentChips(d).filter((a) => !(a.source === 'upload' && inBody.includes(a.id as number)));
  return {
    mode: d.mode,
    accountId: d.accountId,
    to: d.to,
    cc: d.cc,
    bcc: d.bcc,
    subject: d.subject,
    initialHtml: split.bodyHtml,
    quote,
    quoteRemoved,
    attachments,
    // 답장 대상은 저장된 값(WP-1786)을 먼저 — 옛 행엔 없어 답장 원본 id 로 채운다.
    inReplyToMessageId: d.inReplyToMessageId ?? (d.mode === 'reply' ? d.sourceMessageId : null),
    sourceMessageId: d.sourceMessageId,
    draftId: d.id,
    draftVersion: d.version,
    // 보내기 형태로 연 작성은 저장 안 된 작성이다 — 고치지 않고 닫아도(✕·탭 닫기) 곧 쓰기 형태로 다시 저장해, 서버 행에 보내기 형태
    // (인용문이 붙고 cid 이미지인 본문)가 남아 다음에 열거나 보낼 때 인용문이 두 번 붙거나 그림이 깨지지 않게 한다.
    ...(sentForm ? { unsaved: true } : {}),
  };
}

/** 이미 보내는 중인 메일 안내(WP-1786) — 작성창 상태 줄·보내기 거절·보내는 중인 행 열기가 같은 문구를 쓴다. */
export const MAIL_ALREADY_SENDING = '이 메일은 이미 보내는 중이에요';

/** 보내는 중 안내의 덧붙임 — 되돌릴 수 없는(SENDING) 행을 열려 할 때 토스트 설명, 새 창 안내 문장에도 쓴다. */
export const MAIL_ALREADY_SENDING_CHECK_SENT = '보낸편지함에서 확인해 주세요';

/** 보내는 중 안내의 덧붙임 — 아직 대기(QUEUED)라 「되돌리기」를 둘 때 토스트 설명. */
export const MAIL_ALREADY_SENDING_UNDO_REOPENS = '되돌리면 쓰기 창으로 다시 열어요';

/** 보내는 중 안내의 덧붙임 — 이 창의 보내기가 409 DRAFT_SENDING 으로 거절됐을 때 토스트 설명(작성창). */
export const MAIL_ALREADY_SENDING_NOT_SENT_HERE = '다른 창에서 보낸 메일이라 여기서는 보내지 않았어요';

/** 새 창 페이지가 보내는 중인 메일을 열지 않고 보이는 안내 한 문단 — 두 문장을 이어 쓴다. */
export const MAIL_ALREADY_SENDING_NOTICE = `${MAIL_ALREADY_SENDING}. ${MAIL_ALREADY_SENDING_CHECK_SENT}.`;

/** 보내는 중으로 멈춘 작성창에 이 창에서 저장하지 못한 변경이 남았을 때 상태 줄에 덧붙이는 안내(WP-1786 코드 리뷰) — 닫으면 새 임시저장으로 남는다. */
export const INFLIGHT_UNSAVED_NOTE = '최근 변경은 저장하지 못했어요';

/**
 * 보내기 대기열에 올라 보내는 중인 행인가(WP-1786, QUEUED·SENDING). 이런 행은 쓰기 창으로 열지 않는다 — 열어 고치거나 다시 보내면
 * 서버가 거절하거나(409) 같은 메일이 두 번 나갈 수 있다. FAILED 는 보내지 못한 것이라 쓰기 창으로 연다.
 */
export function isSendInFlight(d: Pick<MailDraftDetail, 'sendState'>): boolean {
  return d.sendState === 'QUEUED' || d.sendState === 'SENDING';
}

/** 임시보관함 행의 받는사람 — 짧은 이름을 쉼표로 잇는다. 없으면 빈 문자열(행이 「받는사람 없음」으로 보인다). */
export function draftRecipientsLabel(to: string[]): string {
  return to
    .flatMap((raw) => parseAddressList(raw))
    .map(recipientShortName)
    .join(', ');
}
