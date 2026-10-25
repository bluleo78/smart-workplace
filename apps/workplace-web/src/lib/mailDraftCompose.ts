// 메일 임시저장(WP-577) ↔ 작성창 변환 — 순수 함수만 두어 vitest 로 규칙을 고정한다.
// - 작성창 값 → 저장 요청(buildDraftSavePayload): 본문은 에디터 HTML 만(인용문 제외), 첨부는 올라간 것만.
// - 임시저장 상세 → 작성창 초기값(composeFromDraft): 인용문은 원본 메일로 다시 만들고, 지웠으면 붙이지 않는다.

import type { ComposeDraft } from '@/components/mail/MailComposeContext';
import { type ComposeAttachment, sendAttachmentIds } from '@/lib/mailComposeAttachments';
import { pastedImageIds, uploadIdsWithBodyImages } from '@/lib/mailPastedImages';
import { buildQuote } from '@/lib/mailQuote';
import { parseAddressList, parseRecipientInput, recipientShortName } from '@/lib/mailRecipients';
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
  draft: Pick<ComposeDraft, 'accountId' | 'mode' | 'sourceMessageId'>;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  /** 에디터 본문 HTML — 인용문을 넣지 않는다(다시 열 때 sourceMessageId 로 다시 만들므로 넣으면 두 번 붙는다). */
  bodyHtml: string;
  /** 에디터 본문 평문 — 서버가 목록 미리보기만 만든다. */
  bodyText: string;
  quoteRemoved: boolean;
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
  };
}

/**
 * 임시저장 상세 → 작성창 초기값. source 는 답장·전달 원본 상세(인용문을 지웠거나 받지 못했으면 null).
 * 첨부는 이미 올라간 것이라 완료 칩으로 넣는다(draftAttachmentChips).
 */
export function composeFromDraft(d: MailDraftDetail, source: EmailMessageDetail | null): ComposeDraft {
  // 본문에 붙여 넣은 이미지(WP-947)는 업로드로 묶여 있지만 칩이 아니라 본문에 보인다 — 칩에서 뺀다(저장할 때 본문에서 다시 모은다).
  const inBody = pastedImageIds(d.bodyHtml);
  const attachments = draftAttachmentChips(d).filter((a) => !(a.source === 'upload' && inBody.includes(a.id as number)));
  return {
    mode: d.mode,
    accountId: d.accountId,
    to: d.to,
    cc: d.cc,
    bcc: d.bcc,
    subject: d.subject,
    initialHtml: d.bodyHtml,
    quote: source && !d.quoteRemoved ? buildQuote(source, d.mode === 'forward' ? 'forward' : 'reply') : null,
    quoteRemoved: d.quoteRemoved,
    attachments,
    inReplyToMessageId: d.mode === 'reply' ? d.sourceMessageId : null,
    sourceMessageId: d.sourceMessageId,
    draftId: d.id,
    draftVersion: d.version,
  };
}

/** 임시보관함 행의 받는사람 — 짧은 이름을 쉼표로 잇는다. 없으면 빈 문자열(행이 「받는사람 없음」으로 보인다). */
export function draftRecipientsLabel(to: string[]): string {
  return to
    .flatMap((raw) => parseAddressList(raw))
    .map(recipientShortName)
    .join(', ');
}
