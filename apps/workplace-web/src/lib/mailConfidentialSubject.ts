// 받은 기밀 메일(WP-2030)의 화면 제목 — 서버가 제목 앞에 붙인 「[기밀]」 머리말을 배지로 바꿔 보이므로 제목에서는 뺀다.
import { CONFIDENTIAL_PREFIX } from '@/lib/mailConfidential';
import { mailSubjectText } from '@/lib/mailSubject';

/** 맨 앞 회신 접두들(Re:·Fw:·Fwd:, 한국어 Outlook 의 회신:·전달:·답장: 반복). 「Re: [기밀] 단가」 처럼 접두 뒤에 머리말이 붙은 제목을 다루려고 쓴다. */
const REPLY_PREFIXES = /^(?:\s*(?:re|fw|fwd|회신|전달|답장)\s*:\s*)*/i;

/**
 * 기밀 메일의 표시 제목 — 맨 앞, 또는 맨 앞 회신 접두들 바로 뒤의 「[기밀]」 하나와 뒤 공백을 뺀다.
 * 기밀이 아니면 그대로 돌려준다(사용자가 쓴 「[기밀] 공지」 는 그대로 보인다). 가운데·뒤의 [기밀] 은 둔다.
 */
export function confidentialDisplaySubject(subject: string, confidential: boolean): string {
  if (!confidential) return subject;
  const lead = REPLY_PREFIXES.exec(subject)?.[0] ?? '';
  const rest = subject.slice(lead.length);
  // 접두 뒤에 머리말이 바로 오지 않으면 건드리지 않는다
  if (!rest.startsWith(CONFIDENTIAL_PREFIX)) return subject;
  return lead + rest.slice(CONFIDENTIAL_PREFIX.length).replace(/^\s+/, '');
}

/**
 * 목록 행·상세 머리에 보일 제목 — 기밀이면 머리말을 뺀 뒤, 남은 글자가 없으면 「(제목 없음)」(WP-1110).
 * 머리말 빼기를 먼저 해야 「[기밀]」 만인 제목도 빈칸이 아니라 「(제목 없음)」으로 보인다.
 */
export function mailDisplaySubject(m: { subject?: string | null; confidential?: boolean | null }): string {
  return mailSubjectText(confidentialDisplaySubject(m.subject ?? '', !!m.confidential));
}
