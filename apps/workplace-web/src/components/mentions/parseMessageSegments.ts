// 채팅 본문을 <@id> 토큰 기준으로 표시 세그먼트 배열로 분리. 에디터/DOM 비의존 순수 함수.

import type { ReactNode } from 'react';

import { stripChatMarkdown } from './chatMarkdown';
import type { MentionUser, UserKind } from './types';

/** 칩에 넘길 멘션 조각 — 이름·종류. */
export type MentionSeg = { id: number; name: string; kind: UserKind };

export type MentionSegment = { type: 'text'; value: string } | ({ type: 'mention' } & MentionSeg);

/** 멘션 칩 그리기 — 사람 글(ChatMarkdownText)·AI 글(MarkdownMessage)이 같은 칩을 쓴다(WP-1009). */
export type RenderMention = (m: MentionSeg, key: string) => ReactNode;

/** 멘션 토큰 id → 칩 조각. mentions 에 없으면(탈퇴 등) 「알 수 없음」 사람 — 멘션을 보이는 곳이 모두 이 규칙을 쓴다. */
export function mentionSeg(byId: Map<number, MentionUser>, id: number): MentionSeg {
  const hit = byId.get(id);
  return { id, name: hit?.name ?? '알 수 없음', kind: hit?.kind ?? 'HUMAN' };
}

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
    segments.push({ type: 'mention', ...mentionSeg(byId, Number(m[1])) });
    last = m.index + m[0].length;
  }
  if (last < body.length) segments.push({ type: 'text', value: body.slice(last) });
  return segments;
}

/** 본문을 사람이 읽는 평문으로 — 서식 기호(WP-101)를 빼고 <@id> 토큰을 '@이름' 으로 바꾼다(접근 이름·복사·답장 미리보기용). */
export function messagePlainText(body: string, mentions: MentionUser[]): string {
  return parseMessageSegments(stripChatMarkdown(body), mentions)
    .map((seg) => (seg.type === 'text' ? seg.value : `@${seg.name}`))
    .join('');
}
