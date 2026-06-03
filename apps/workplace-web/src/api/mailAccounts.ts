// 메일 계정 CRUD + 연결 테스트 API. baseURL '/api/v1' 가 client 에 포함되어 있어 경로는 상대로 작성.
import type {
  ConnectionTestResult,
  MailAccountRequest,
  MailAccountResponse,
} from '../types/mailAccount';

import { client } from './client';

// baseURL 은 '/api/v1' 이므로 여기선 '/mail/accounts' 만 쓴다.
export async function listMailAccounts(): Promise<MailAccountResponse[]> {
  const { data } = await client.get<MailAccountResponse[]>('/mail/accounts');
  return data;
}

export async function createMailAccount(
  body: MailAccountRequest,
): Promise<MailAccountResponse> {
  const { data } = await client.post<MailAccountResponse>('/mail/accounts', body);
  return data;
}

export async function updateMailAccount(
  id: number,
  body: MailAccountRequest,
): Promise<MailAccountResponse> {
  const { data } = await client.put<MailAccountResponse>(`/mail/accounts/${id}`, body);
  return data;
}

export async function deleteMailAccount(id: number): Promise<void> {
  await client.delete(`/mail/accounts/${id}`);
}

export async function testMailConnection(
  body: MailAccountRequest,
): Promise<ConnectionTestResult> {
  const { data } = await client.post<ConnectionTestResult>('/mail/accounts/test', body);
  return data;
}
