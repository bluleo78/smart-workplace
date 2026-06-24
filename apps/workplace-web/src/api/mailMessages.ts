// 받은편지함/보낸편지함 동기화·읽기·발송 API. baseURL '/api/v1' 가 client 에 포함.
import { downloadBlob } from '../lib/download';
import type {
  DraftCoachingRequest,
  EmailMessageDetail,
  EmailMessageSummary,
  MailDraftCoaching,
  MailFolder,
  MailSendRequest,
  MailSyncResult,
  MailSyncStatus,
  SendResult,
} from '../types/mailMessage';
import { client } from './client';

/** 계정의 INBOX 를 증분 동기화(수동 트리거). */
export async function syncMailbox(accountId: number): Promise<MailSyncResult> {
  const { data } = await client.post<MailSyncResult>(
    `/mail/accounts/${accountId}/sync`,
  );
  return data;
}

/** 계정 동기화 진행 상태(폴링용). */
export async function getSyncStatus(accountId: number): Promise<MailSyncStatus> {
  const { data } = await client.get<MailSyncStatus>(
    `/mail/accounts/${accountId}/sync-status`,
  );
  return data;
}

/** 계정의 메시지 목록(폴더 스코프, 최신순, 선택 검색어·unread·category·needsReply 필터). */
export async function listMessages(
  accountId: number,
  folder: MailFolder,
  query?: string,
  unread?: boolean,
  category?: string,
  needsReply?: boolean,
): Promise<EmailMessageSummary[]> {
  const { data } = await client.get<EmailMessageSummary[]>(
    `/mail/accounts/${accountId}/messages`,
    {
      params: {
        folder,
        ...(query ? { query } : {}),
        // #469: unread=true 면 안 읽은 메일만.
        ...(unread ? { unread: true } : {}),
        // P2: AI 분류 필터.
        ...(category ? { category } : {}),
        // P2: 회신필요(미처리) 필터.
        ...(needsReply ? { needsReply: true } : {}),
      },
    },
  );
  return data;
}

/** P2: 계정의 회신필요(미처리) 메일 건수. 사이드바 배지용. */
export async function getNeedsReplyCount(accountId: number): Promise<number> {
  const { data } = await client.get<{ count: number }>(
    `/mail/accounts/${accountId}/needs-reply-count`,
  );
  return data.count;
}

/** P2: 회신필요 처리완료 표시. */
export async function markNeedsReplyDone(accountId: number, messageId: number): Promise<void> {
  await client.post(`/mail/accounts/${accountId}/messages/${messageId}/needs-reply-done`);
}

/** P2: 회신필요 처리완료 취소. */
export async function clearNeedsReplyDone(accountId: number, messageId: number): Promise<void> {
  await client.delete(`/mail/accounts/${accountId}/messages/${messageId}/needs-reply-done`);
}

/** 메시지 단건 상세(본문 + 첨부 메타). */
export async function getMessage(messageId: number): Promise<EmailMessageDetail> {
  const { data } = await client.get<EmailMessageDetail>(`/mail/messages/${messageId}`);
  return data;
}

/** 메일 요약(캐시 우선). */
export async function getMailSummary(messageId: number): Promise<{ summary: string | null }> {
  const { data } = await client.get<{ summary: string | null }>(`/mail/messages/${messageId}/summary`)
  return data
}

/** AI 답장 초안 생성(미영속). */
export async function generateReplyDraft(messageId: number): Promise<{ draftBody: string }> {
  const { data } = await client.post<{ draftBody: string }>(`/mail/messages/${messageId}/reply-draft`)
  return data
}

/** 내 초안 코칭(미영속). */
export async function coachDraft(req: DraftCoachingRequest): Promise<MailDraftCoaching> {
  const { data } = await client.post<MailDraftCoaching>('/mail/draft-coaching', req)
  return data
}

/** 메일 발송(새 메일·답장·전달). inReplyToMessageId 가 있으면 답장. */
export async function sendMail(
  accountId: number,
  body: MailSendRequest,
): Promise<SendResult> {
  const { data } = await client.post<SendResult>(
    `/mail/accounts/${accountId}/send`,
    body,
  );
  return data;
}

/**
 * 첨부 파일 바이너리 다운로드. axios arraybuffer 로 수신 후 Blob 생성 → downloadBlob 헬퍼로 브라우저 다운로드를
 * 트리거한다. Bearer 인증이 필요한 API 이므로 단순 <a href> 대신 axios 를 사용한다.
 */
export async function downloadMailAttachment(
  attachmentId: number,
  filename: string,
): Promise<void> {
  const { data, headers } = await client.get<ArrayBuffer>(
    `/mail/attachments/${attachmentId}/content`,
    { responseType: 'arraybuffer' },
  );
  const contentType =
    (headers['content-type'] as string | undefined) || 'application/octet-stream';
  const blob = new Blob([data], { type: contentType });
  downloadBlob(filename || `attachment-${attachmentId}`, blob);
}
