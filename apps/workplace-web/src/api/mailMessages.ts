// 받은편지함 동기화·읽기 API. baseURL '/api/v1' 가 client 에 포함되어 경로는 상대로 작성.
import type {
  EmailMessageDetail,
  EmailMessageSummary,
  MailSyncResult,
} from '../types/mailMessage';
import { client } from './client';

/** 계정의 INBOX 를 증분 동기화(수동 트리거). */
export async function syncMailbox(accountId: number): Promise<MailSyncResult> {
  const { data } = await client.post<MailSyncResult>(
    `/mail/accounts/${accountId}/sync`,
  );
  return data;
}

/** 계정의 메시지 목록(최신순, 선택적 검색어). */
export async function listMessages(
  accountId: number,
  query?: string,
): Promise<EmailMessageSummary[]> {
  const { data } = await client.get<EmailMessageSummary[]>(
    `/mail/accounts/${accountId}/messages`,
    { params: query ? { query } : undefined },
  );
  return data;
}

/** 메시지 단건 상세(본문 + 첨부 메타). */
export async function getMessage(messageId: number): Promise<EmailMessageDetail> {
  const { data } = await client.get<EmailMessageDetail>(`/mail/messages/${messageId}`);
  return data;
}
