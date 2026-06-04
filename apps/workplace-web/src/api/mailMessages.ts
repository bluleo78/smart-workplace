// 받은편지함/보낸편지함 동기화·읽기·발송 API. baseURL '/api/v1' 가 client 에 포함.
import type {
  EmailMessageDetail,
  EmailMessageSummary,
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

/** 계정의 메시지 목록(폴더 스코프, 최신순, 선택 검색어). */
export async function listMessages(
  accountId: number,
  folder: MailFolder,
  query?: string,
): Promise<EmailMessageSummary[]> {
  const { data } = await client.get<EmailMessageSummary[]>(
    `/mail/accounts/${accountId}/messages`,
    { params: { folder, ...(query ? { query } : {}) } },
  );
  return data;
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
