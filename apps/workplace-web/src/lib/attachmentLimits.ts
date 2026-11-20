// 첨부 공용 한도 — 이슈 첨부·메인 AI 채팅 첨부(WP-234)가 같은 서버 상한(workplace.storage.attachment)을 쓰므로 한 곳에 둔다.
// API 클라이언트를 끌어오지 않는 순수 모듈이라 lib 규칙·vitest 에서도 가볍게 import 한다.
import { eunNeun } from '@/lib/utils';

/** 파일당 업로드 상한 — 서버 workplace.storage.attachment 와 같은 25MB. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** 파일 하나가 한도를 넘었을 때 안내 — 이슈 첨부·팀 채팅·이슈 챗이 같은 문구를 쓴다(WP-848). 예: 「보고서.pdf는 25MB 한도를 초과합니다」. */
export function oversizeFileMessage(name: string): string {
  return `${name}${eunNeun(name)} 25MB 한도를 초과합니다`;
}

/** 개수 판정 결과 — ok=false 면 message 를 토스트로 보이고 이번 묶음 전체를 올리지 않는다. */
export type CountCheck = { ok: true } | { ok: false; message: string };

/** 메시지당 첨부 수 — 팀 채팅·이슈 챗·메인 AI 채팅이 같은 10개를 쓴다(이슈 첨부의 ATTACHMENT_MAX_PER_ISSUE 는 이슈 전체 누적 상한이라 뜻이 달라 공유하지 않는다). */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/**
 * 새로 붙이는 파일 묶음이 메시지당 한도를 넘기는지 업로드 전에 판정한다 — 나눠 붙여도 합이 한도를 넘기 전에 막기 위함(WP-1857).
 * 넘으면 묶음 전체를 받지 않고, 남은 자리 수를 문구에 알려 사용자가 바로 줄여 다시 붙일 수 있게 한다.
 *
 * @param incoming 이번에 붙이는 파일 수(0 이면 항상 ok)
 * @param draftCount 입력창 초안 칩 + 아직 업로드 중인 파일 수
 * @param max 메시지당 한도(기본 MAX_ATTACHMENTS_PER_MESSAGE)
 */
export function checkDraftFileCount(
  incoming: number,
  draftCount: number,
  max: number = MAX_ATTACHMENTS_PER_MESSAGE,
): CountCheck {
  if (incoming <= 0 || draftCount + incoming <= max) return { ok: true };
  const remaining = Math.max(0, max - draftCount);
  const tail = remaining === 0 ? '더 붙일 수 없어요' : `${remaining}개 더 붙일 수 있어요`;
  return { ok: false, message: `첨부는 메시지당 최대 ${max}개예요 — ${tail}` };
}
