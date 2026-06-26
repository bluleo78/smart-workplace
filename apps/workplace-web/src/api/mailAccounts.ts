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

/**
 * M365 Graph OAuth 인가 URL을 인증된 axios로 조회한다(C1 수정).
 *
 * 기존 window.location.href = '/start' top-level 이동은 Bearer 헤더를 실을 수 없어
 * @AuthenticationPrincipal userId가 null → NPE 500. 대신 axios로 받고 location.href 이동.
 */
export async function getM365AuthorizeUrl(): Promise<string> {
  const { data } = await client.get<{ authorizeUrl: string }>('/mail/oauth/m365/start');
  return data.authorizeUrl;
}

/**
 * 팝업 콜백 페이지가 AAD 인가 코드를 백엔드로 중계한다(공개 경로 — state 로 신원 복원).
 * 성공 200 {connected:true}, 실패 시 axios 가 4xx 로 throw.
 */
export async function completeM365OAuth(body: {
  code: string
  state: string
}): Promise<{ connected: boolean }> {
  const { data } = await client.post<{ connected: boolean }>(
    '/mail/oauth/m365/complete',
    body,
  )
  return data
}

// 기존 계정 연결 테스트 — 비밀번호 미입력 시 서버가 저장된 비밀번호로 폴백(#448).
export async function testMailConnectionForAccount(
  id: number,
  body: MailAccountRequest,
): Promise<ConnectionTestResult> {
  const { data } = await client.post<ConnectionTestResult>(
    `/mail/accounts/${id}/test`,
    body,
  );
  return data;
}
