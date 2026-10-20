// 메일 작성창 첨부(WP-574) — 칩 하나의 상태 모델과 순수 규칙(합계·한도·전달 첨부 변환). 업로드 부수효과는 useMailComposeAttachments 가 맡는다.
// 순수 함수만 두어 vitest 로 규칙을 고정할 수 있게 한다.

import { mailAttachmentMime, mailAttachmentName } from '@/components/viewer/viewerItems';
import { ATTACHMENT_MAX_BYTES } from '@/lib/attachmentLimits';
import type { MailQuote } from '@/lib/mailQuote';
import type { EmailAttachmentMeta } from '@/types/mailMessage';

/** 칩 상태 — 올리는 중 / 올라감(전달 원본 첨부는 처음부터 올라감) / 실패. */
export type ComposeAttachmentStatus = 'uploading' | 'done' | 'error';

/** 작성창 첨부 한 개(칩 하나). */
export interface ComposeAttachment {
  /** 화면 key — 같은 파일을 두 번 넣어도 겹치지 않게 작성창이 매긴다. */
  key: string;
  name: string;
  /** 바이트. */
  size: number;
  mimeType: string;
  status: ComposeAttachmentStatus;
  /** 업로드 진행률 0~100(%). 올라간 첨부는 100. */
  progress: number;
  /** 실패 사유(칩에 그대로 보인다). */
  error?: string;
  /** 다시 시도로 풀릴 실패인가 — 한도 초과는 다시 올려도 같으므로 false(「다시 시도」를 달지 않는다). */
  retryable?: boolean;
  /** upload = 내가 올린 파일, forward = 전달하는 원본 메일의 첨부. */
  source: 'upload' | 'forward';
  /** upload → 업로드 응답 id(작성 임시 첨부), forward → 원본 메일 첨부 id. 올리는 중·실패면 없다. */
  id?: number;
  /** 고른 원본 파일 — 다시 시도에 쓴다. 전달 원본·한도 초과 칩은 없다. */
  file?: File;
}

/**
 * 한 메일에 붙일 수 있는 첨부 합계 상한 — 서버 파일 상한(25MB)과 같은 값을 메일 한 통 합계에 쓴다.
 * 받는 쪽 메일 서버 대부분이 메시지 전체 25MB 안팎에서 거절하므로 파일당이 아니라 합계로 막는다.
 */
export const COMPOSE_ATTACHMENT_TOTAL_MAX = ATTACHMENT_MAX_BYTES;
const LIMIT_MB = COMPOSE_ATTACHMENT_TOTAL_MAX / (1024 * 1024);
/** 합계 줄의 상한 — 공용 크기 포매터(formatFileSize)와 같은 "숫자 단위" 띄어쓰기("4.2 MB / 25 MB"). */
export const COMPOSE_ATTACHMENT_LIMIT_LABEL = `${LIMIT_MB} MB`;
/** 문장 안 상한 이름("25MB를 넘어요"·"25MB까지"). */
export const COMPOSE_ATTACHMENT_LIMIT_WORD = `${LIMIT_MB}MB`;
/** 한도를 넘어 붙이지 못한 파일의 칩 사유. */
export const OVER_LIMIT_MESSAGE = `${COMPOSE_ATTACHMENT_LIMIT_WORD}를 넘어요`;
/** 서버·네트워크 실패의 칩 사유(다시 시도 가능). */
export const UPLOAD_FAILED_MESSAGE = '올리지 못했어요';

/** 합계에 드는 첨부 — 실패한 칩은 보내지 않으므로 뺀다(올리는 중은 곧 붙을 것이라 넣는다). */
function counted(items: ComposeAttachment[]): ComposeAttachment[] {
  return items.filter((a) => a.status !== 'error');
}

/** 합계 — 「첨부 3개 · 4.2MB / 25MB」 표시용. */
export interface AttachmentTotals {
  /** 칩 개수(실패 제외). */
  count: number;
  /** 한도에 드는 바이트 — 칩 크기 + reservedBytes. */
  bytes: number;
  /** 칩으로 보이지 않지만 함께 나가 한도에 드는 바이트(인용문이 다시 붙이는 본문 이미지). */
  reservedBytes: number;
}

/**
 * 합계 — 칩(실패 제외)에 reservedBytes(인용문 본문 이미지)를 더한다.
 * 서버는 업로드 + 전달 원본 + 인용문 인라인 이미지를 합쳐 한 통 25MB 로 거르므로, 화면도 같은 합으로 세야 「켜진 보내기 → 서버 거절」이 없다.
 */
export function attachmentTotals(items: ComposeAttachment[], reservedBytes = 0): AttachmentTotals {
  const list = counted(items);
  return { count: list.length, bytes: list.reduce((sum, a) => sum + a.size, reservedBytes), reservedBytes };
}

/** size 바이트를 더 붙이면 합계 상한을 넘는가(reservedBytes 포함). */
export function exceedsTotalLimit(items: ComposeAttachment[], size: number, reservedBytes = 0): boolean {
  return attachmentTotals(items, reservedBytes).bytes + size > COMPOSE_ATTACHMENT_TOTAL_MAX;
}

/**
 * 인용문이 cid 로 다시 붙이는 본문 이미지의 바이트 합 — 발송 요청 inlineImages 와 같은 항목(서버도 항목마다 원본 크기를 더한다).
 * 인용문을 지우면(quote=null) 0 이다.
 */
export function quoteInlineBytes(quote: Pick<MailQuote, 'inlineImages'> | null | undefined): number {
  return (quote?.inlineImages ?? []).reduce((sum, i) => sum + i.attachment.sizeBytes, 0);
}

/**
 * 실패 칩 key 를 다시 올리면 합계 상한을 넘는가 — 실패 칩은 합계에서 빠져 있으므로, 실패한 동안 다른 파일이 붙었으면
 * 다시 시도가 한도를 우회할 수 있다. 자기 자신을 뺀 나머지 합계에 자기 크기를 더해 본다. 없는 key 면 false.
 */
export function retryExceedsTotalLimit(items: ComposeAttachment[], key: string, reservedBytes = 0): boolean {
  const target = items.find((a) => a.key === key);
  if (!target) return false;
  return exceedsTotalLimit(
    items.filter((a) => a.key !== key),
    target.size,
    reservedBytes,
  );
}

/**
 * 전달할 원본 첨부 → 칩. 인용문이 cid 로 다시 붙이는 인라인 이미지(excludeIds)는 빼야 같은 그림이 두 번 붙지 않는다
 * (받은 메일 상세의 첨부 목록이 본문에 박힌 이미지를 빼는 것과 같은 규칙).
 */
export function forwardAttachments(
  attachments: EmailAttachmentMeta[],
  excludeIds: ReadonlySet<number> = new Set(),
): ComposeAttachment[] {
  return attachments
    .filter((a) => !excludeIds.has(a.id))
    .map((a) => ({
      key: `forward-${a.id}`,
      name: mailAttachmentName(a),
      size: a.sizeBytes,
      mimeType: mailAttachmentMime(a),
      status: 'done',
      progress: 100,
      source: 'forward',
      id: a.id,
    }));
}

/** 보내기 잠금 — 이유 문구와 톤(error = 사용자가 고쳐야 함·destructive 색, pending = 기다리면 풀림·muted 색). */
export interface SendBlock {
  reason: string;
  tone: 'error' | 'pending';
}

/**
 * 보내기를 잠그는 이유 — 실패 칩이 있으면 빼거나 다시 시도하라고, 합계가 넘으면 빼라고, 올리는 중이면 기다리라고 알린다. 보낼 수 있으면 null.
 * 사용자가 손대야 풀리는 이유를 기다리면 풀리는 이유보다 먼저 고른다 — 올리는 중 칩과 실패 칩이 함께 있으면 실패를 알린다(문구와 색이 같은 이유를 가리키게).
 * 실패 칩을 두고 보내면 사용자가 붙였다고 믿는 파일이 빠진 채 나가므로 막는다. 작성창 보내기 버튼과 잠금 안내가 같은 값을 쓴다.
 */
export function sendBlock(items: ComposeAttachment[], reservedBytes = 0): SendBlock | null {
  if (items.some((a) => a.status === 'error')) {
    return { reason: '올리지 못한 첨부를 빼거나 다시 시도해야 보낼 수 있어요.', tone: 'error' };
  }
  // 붙일 때마다 한도를 보지만, 전달로 연 순간 원본 첨부 + 본문 이미지가 이미 넘을 수 있다 — 서버 거절 전에 알린다.
  if (attachmentTotals(items, reservedBytes).bytes > COMPOSE_ATTACHMENT_TOTAL_MAX) {
    return { reason: `첨부가 모두 ${COMPOSE_ATTACHMENT_LIMIT_WORD}를 넘어요. 첨부를 빼야 보낼 수 있어요.`, tone: 'error' };
  }
  if (items.some((a) => a.status === 'uploading')) {
    return { reason: '첨부를 올리는 중이에요. 다 올라가면 보낼 수 있어요.', tone: 'pending' };
  }
  return null;
}

/** 실패 칩 개수 — 합계 줄 「첨부 2개 · 실패 1」. */
export function failedCount(items: ComposeAttachment[]): number {
  return items.filter((a) => a.status === 'error').length;
}

/**
 * 발송 요청의 첨부 id — 올린 파일(완료된 것만)은 attachmentIds, 전달 원본은 forwardAttachmentIds.
 * 보내기는 sendBlock 이 없을 때만 열리므로 여기 오는 칩은 모두 완료 상태다(방어로 한 번 더 거른다).
 */
export function sendAttachmentIds(items: ComposeAttachment[]): { attachmentIds: number[]; forwardAttachmentIds: number[] } {
  const ids = (source: ComposeAttachment['source']) =>
    items.filter((a) => a.source === source && a.status === 'done' && a.id != null).map((a) => a.id as number);
  return { attachmentIds: ids('upload'), forwardAttachmentIds: ids('forward') };
}

/**
 * 첨부가 처음 연 상태에서 바뀌었나(버림 확인용) — 올린 파일이 하나라도 있거나, 전달 원본 첨부를 뺐으면 쓴 내용으로 본다.
 * 전달로 열자마자 닫는 것까지 묻지 않게, 처음 채워진 전달 첨부는 다른 칸처럼 기준값으로 친다.
 */
export function attachmentsChanged(items: ComposeAttachment[], initial: ComposeAttachment[]): boolean {
  if (items.some((a) => a.source === 'upload')) return true;
  const keys = new Set(items.map((a) => a.key));
  return initial.some((a) => !keys.has(a.key));
}
