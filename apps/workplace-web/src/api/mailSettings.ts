// 메일 사용자 설정 REST 호출(WP-1744) — 사용자당 하나인 설정(작성 방식 기본값)을 읽고 저장한다.
import type { MailUserSettings } from '../types/mailSettings';
import { client } from './client';

/** 내 메일 설정 — 아직 저장한 적이 없으면 서버가 기본값(composeMode DOCK)을 돌려준다. */
export async function getMailSettings(): Promise<MailUserSettings> {
  const { data } = await client.get<MailUserSettings>('/mail/settings');
  return data;
}

/** 메일 설정 저장 — 저장된 값을 그대로 돌려준다. 알 수 없는 값은 400. */
export async function updateMailSettings(body: MailUserSettings): Promise<MailUserSettings> {
  const { data } = await client.put<MailUserSettings>('/mail/settings', body);
  return data;
}
