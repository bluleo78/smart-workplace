// TipTap JSON 도큐먼트 ↔ chat 본문(<@id> 토큰) 변환. 에디터/DOM 비의존 순수 함수.

import type { JSONContent } from '@tiptap/core';

import type { MentionUser, UserKind } from './types';

// TipTap JSON(doc) → 본문 문자열. mention 노드는 <@id>, 문단 경계는 \n, hardBreak 노드도 \n.
export function serializeToBody(doc: JSONContent): string {
  const paragraphs = (doc.content ?? []).map((para) => {
    const inline = (para.content ?? [])
      .map((node) => {
        if (node.type === 'mention') return `<@${node.attrs?.id}>`;
        // Shift+Enter 로 삽입된 hardBreak 노드 → \n 변환 (#357)
        if (node.type === 'hardBreak') return '\n';
        return node.text ?? '';
      })
      .join('');
    return inline;
  });
  return paragraphs.join('\n');
}

// #366: 자동완성 드롭다운 없이 평문으로 입력한 @<에이전트이름> 을 <@id> 토큰으로 변환한다.
// 평문 멘션은 mention 노드가 생성되지 않아 body 에 일반 텍스트로 남고 mentions=[] 가 되는데,
// 백엔드(MentionParser)는 body 의 <@id> 에서 멘션을 파생하므로 AI 트리거가 누락된다(#366).
// 이름을 "전체 문자열"로 매칭하므로 이름에 공백("My AI")이 있어도 안전하고,
// 긴 이름 우선(longest-first)으로 부분일치를 방지한다. AI 트리거가 목적이므로 AGENT 만 대상.
export function convertPlaintextMentions(
  body: string,
  candidates: { userId: number; name: string; kind: UserKind }[],
): string {
  const agents = candidates
    .filter((c) => c.kind === 'AGENT' && c.name)
    // 긴 이름 우선 — "My AI Pro" 를 "My AI" 보다 먼저 치환해 부분일치를 막는다.
    .sort((a, b) => b.name.length - a.name.length);
  let out = body;
  for (const a of agents) {
    const escaped = a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 앞: 문자열 시작 또는 영숫자/@ 가 아닌 문자(이메일 "user@..."·이미 변환된 토큰 재매칭 방지).
    // 뒤: ASCII 단어문자가 아니어야 함(@My AIx 처럼 더 긴 토큰의 일부 오매칭 방지).
    const re = new RegExp(`(^|[^\\w@])@${escaped}(?![\\w])`, 'g');
    out = out.replace(re, `$1<@${a.userId}>`);
  }
  return out;
}

// 본문 문자열 → TipTap JSON(doc). <@id> 는 mention 노드(label=이름)로 복원.
export function bodyToDoc(body: string, mentions: MentionUser[]): JSONContent {
  const nameById = new Map(mentions.map((m) => [m.id, m.name]));
  const lines = body.split('\n');
  const content: JSONContent[] = lines.map((line) => {
    const inline: JSONContent[] = [];
    const re = /<@(\d+)>/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) inline.push({ type: 'text', text: line.slice(last, m.index) });
      const id = Number(m[1]);
      inline.push({ type: 'mention', attrs: { id, label: nameById.get(id) ?? '알 수 없음' } });
      last = m.index + m[0].length;
    }
    if (last < line.length) inline.push({ type: 'text', text: line.slice(last) });
    return inline.length > 0 ? { type: 'paragraph', content: inline } : { type: 'paragraph' };
  });
  return { type: 'doc', content };
}
