// TipTap JSON 도큐먼트 ↔ chat 본문(<@id> 토큰) 변환. 에디터/DOM 비의존 순수 함수.

import type { JSONContent } from '@tiptap/core';

import type { ChatMentionResponse } from '@/types/chat';

// TipTap JSON(doc) → 본문 문자열. mention 노드는 <@id>, 문단 경계는 \n.
export function serializeToBody(doc: JSONContent): string {
  const paragraphs = (doc.content ?? []).map((para) => {
    const inline = (para.content ?? [])
      .map((node) => {
        if (node.type === 'mention') return `<@${node.attrs?.id}>`;
        return node.text ?? '';
      })
      .join('');
    return inline;
  });
  return paragraphs.join('\n');
}

// 본문 문자열 → TipTap JSON(doc). <@id> 는 mention 노드(label=이름)로 복원.
export function bodyToDoc(body: string, mentions: ChatMentionResponse[]): JSONContent {
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
