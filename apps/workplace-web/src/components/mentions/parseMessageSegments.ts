// 채팅 본문을 <@id> 토큰 기준으로 표시 세그먼트 배열로 분리. 에디터/DOM 비의존 순수 함수.

import type { MentionUser, UserKind } from './types';

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; id: number; name: string; kind: UserKind };

export function parseMessageSegments(
  body: string,
  mentions: MentionUser[],
): MentionSegment[] {
  const byId = new Map(mentions.map((m) => [m.id, m]));
  const segments: MentionSegment[] = [];
  const re = /<@(\d+)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) segments.push({ type: 'text', value: body.slice(last, m.index) });
    const id = Number(m[1]);
    const hit = byId.get(id);
    segments.push({
      type: 'mention',
      id,
      name: hit?.name ?? '알 수 없음',
      kind: hit?.kind ?? 'HUMAN',
    });
    last = m.index + m[0].length;
  }
  if (last < body.length) segments.push({ type: 'text', value: body.slice(last) });
  return segments;
}

/** 본문을 사람이 읽는 평문으로 — <@id> 토큰을 '@이름' 으로 바꾼다(접근 이름·복사용). */
export function messagePlainText(body: string, mentions: MentionUser[]): string {
  return parseMessageSegments(body, mentions)
    .map((seg) => (seg.type === 'text' ? seg.value : `@${seg.name}`))
    .join('');
}
