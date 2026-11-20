// 메일 임시저장(WP-577) API. baseURL '/api/v1' 가 client 에 포함.
import type {
  MailDraftCount,
  MailDraftCreated,
  MailDraftDetail,
  MailDraftSaveRequest,
  MailDraftSummary,
  MailDraftUpdated,
  MailScheduledSummary,
} from '../types/mailDraft';
import { client } from './client';

/** 계정의 임시보관함 목록(최근 저장 순). */
export async function listMailDrafts(accountId: number): Promise<MailDraftSummary[]> {
  const { data } = await client.get<MailDraftSummary[]>('/mail/drafts', { params: { accountId } });
  return data;
}

/**
 * 계정의 임시저장 개수 — 사이드바 배지(count). queued 는 보내기 대기 수(WP-1786) — 계정 삭제 확인창이 함께 지워질 대기를 알린다. scheduled 는 예약 수(WP-1787).
 */
export async function getMailDraftCount(accountId: number): Promise<MailDraftCount> {
  const { data } = await client.get<MailDraftCount>('/mail/drafts/count', { params: { accountId } });
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

/** 계정의 예약 목록(WP-1787) — 보낼 시각 오름차순, 최대 100건. */
export async function listScheduledMailDrafts(accountId: number): Promise<MailScheduledSummary[]> {
  const { data } = await client.get<MailScheduledSummary[]>('/mail/drafts/scheduled', { params: { accountId } });
  return data;
}

/** 예약을 지금 보낸다(WP-1787) — 대기열 흐름을 타 10초 되돌리기 없이 곧 나간다. 이미 보내는 중이면 409 ALREADY_SENDING, 내 예약이 아니면 404. */
export async function sendScheduledMailNow(draftId: number): Promise<{ draftId: number; sendAt: string }> {
  const { data } = await client.post<{ draftId: number; sendAt: string }>(`/mail/drafts/${draftId}/send-now`);
  return data;
}
