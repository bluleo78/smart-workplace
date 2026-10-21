// 메일 임시저장(WP-577) API. baseURL '/api/v1' 가 client 에 포함.
import type {
  MailDraftCreated,
  MailDraftDetail,
  MailDraftSaveRequest,
  MailDraftSummary,
  MailDraftUpdated,
} from '../types/mailDraft';
import { client } from './client';

/** 계정의 임시보관함 목록(최근 저장 순). */
export async function listMailDrafts(accountId: number): Promise<MailDraftSummary[]> {
  const { data } = await client.get<MailDraftSummary[]>('/mail/drafts', { params: { accountId } });
  return data;
}

/** 계정의 임시저장 개수 — 사이드바 배지. */
export async function getMailDraftCount(accountId: number): Promise<{ count: number }> {
  const { data } = await client.get<{ count: number }>('/mail/drafts/count', { params: { accountId } });
  return data;
}

/** 임시저장 하나(작성창을 다시 열 때). */
export async function getMailDraft(id: number): Promise<MailDraftDetail> {
  const { data } = await client.get<MailDraftDetail>(`/mail/drafts/${id}`);
  return data;
}

/** 첫 저장 — 새 임시저장을 만든다. */
export async function createMailDraft(body: MailDraftSaveRequest): Promise<MailDraftCreated> {
  const { data } = await client.post<MailDraftCreated>('/mail/drafts', body);
  return data;
}

/** 이후 저장 — body.version 이 서버 버전과 다르면 409 DRAFT_CONFLICT. */
export async function updateMailDraft(id: number, body: MailDraftSaveRequest): Promise<MailDraftUpdated> {
  const { data } = await client.put<MailDraftUpdated>(`/mail/drafts/${id}`, body);
  return data;
}

/** 임시저장 버리기(204). */
export async function deleteMailDraft(id: number): Promise<void> {
  await client.delete(`/mail/drafts/${id}`);
}
