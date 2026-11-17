// TipTap JSON 도큐먼트 ↔ chat 본문(<@id> 토큰) 변환. 에디터/DOM 비의존 순수 함수.

import type { JSONContent } from '@tiptap/core';

import { imageMarkdown } from '../../lib/markdownImageInsert';
import { API_IMAGE_MD } from './apiImageSegments';
import { chatMarkdownToDoc, hasChatFormatting, serializeChatMarkdown } from './chatMarkdownDoc';
import type { MentionUser, UserKind } from './types';

// TipTap JSON(doc) → 본문 문자열. mention 노드는 <@id>, 문단 경계는 \n, hardBreak 노드도 \n.
// image 노드(WP-362)는 마크다운 `![이름](src)` — 업로드 중(src 없음) 노드는 빈 문자열(전송은 RichInput 이 막는다).
// 서식(굵게·목록·코드 블록 등, WP-101)이 든 문서는 채팅 마크다운으로 — 서식 없는 문서는 아래 기존 경로 그대로(코멘트 등과 바이트 단위로 같게).
export function serializeToBody(doc: JSONContent): string {
  if (hasChatFormatting(doc)) return serializeChatMarkdown(doc);
  const paragraphs = (doc.content ?? []).map((para) => {
    const inline = (para.content ?? [])
      .map((node) => {
        if (node.type === 'mention') return `<@${node.attrs?.id}>`;
        // Shift+Enter 로 삽입된 hardBreak 노드 → \n 변환 (#357)
        if (node.type === 'hardBreak') return '\n';
        if (node.type === 'image') {
          const src = node.attrs?.src as string | null | undefined;
          return src ? imageMarkdown(String(node.attrs?.alt ?? ''), src) : '';
        }
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
// images 가 켜진 입력창(이슈 코멘트, WP-362)만 `![이름](/api/v1/...)` 을 image 노드로 복원한다 — 그 밖의 입력창은 스키마에 image 가 없다.
// formatting 이 켜진 입력창(팀 채팅·이슈 채팅, WP-101)은 채팅 마크다운으로 읽어 굵게·목록 등을 복원한다(렌더러와 같은 파서).
// imageProjectKey(본문 모드, WP-1656)가 있으면 그 프로젝트 이미지만 노드로 — 다른 프로젝트 경로는 보기 화면도 그리지 못해 글자로 둔다.
// 또 저장 형식(imageMarkdown)과 다른 모양(alt 앞뒤 공백·`[`)은 노드로 만들면 저장할 때 모양이 바뀌므로 글자로 둔다 — 원문을 한 바이트도 바꾸지 않게.
// 본문 모드(imageProjectKey 가 있을 때만)는 더:
// - 줄바꿈 \r\n·\r 도 줄로 나눈다 — \n 으로만 나누면 문단 끝에 \r 이 남아, 그 줄을 고칠 때 편집기가 \r 을 공백으로 다시 읽어
//   줄바꿈이 섞이고 공백이 끼었다. 고친 뒤 저장하면 \n 줄이 된다(옛 Textarea 와 같다). \n 만 쓴 원문은 지금처럼 바이트 그대로다.
// - <@숫자> 는 숫자가 그대로 다시 써지는 모양(앞 0 없음·안전한 정수)일 때만 멘션 노드로 — `<@007>`·아주 큰 숫자는 Number() 를 거치면
//   다른 글자로 저장되므로 글자로 둔다.
export function bodyToDoc(
  body: string,
  mentions: MentionUser[],
  options: { images?: boolean; formatting?: boolean; imageProjectKey?: string } = {},
): JSONContent {
  if (options.formatting) return chatMarkdownToDoc(body, mentions);
  const nameById = new Map(mentions.map((m) => [m.id, m.name]));
  // imageProjectKey 는 본문 모드(WP-1656)만 넘긴다 — 이것 하나로 본문 모드 규칙(이미지 고르기·줄바꿈·멘션 id)을 켠다.
  const projectKey = options.imageProjectKey;
  const bodyMode = projectKey != null;
  const lines = bodyMode ? body.split(/\r\n|\r|\n/) : body.split('\n');
  // 멘션 토큰과 (켜져 있으면) 이미지 마크다운을 한 정규식으로 왼쪽부터 훑는다 — 줄마다 lastIndex 만 되돌려 재사용.
  const re = options.images ? new RegExp(`<@(\\d+)>|${API_IMAGE_MD.source}`, 'g') : /<@(\d+)>/g;
  const content: JSONContent[] = lines.map((line) => {
    const inline: JSONContent[] = [];
    re.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      // 본문 모드에서 받지 않는 이미지(다른 프로젝트·저장 형식과 다른 모양)는 건너뛰어 앞뒤 글자와 함께 글자로 남긴다. group(4)=프로젝트 키.
      if (m[1] === undefined && bodyMode && !isBodyModeImage(m, projectKey)) continue;
      // 본문 모드에서 다시 쓰면 글자가 바뀌는 멘션 id 도 글자로 남긴다.
      if (m[1] !== undefined && bodyMode && !isExactMentionId(m[1])) continue;
      if (m.index > last) inline.push({ type: 'text', text: line.slice(last, m.index) });
      if (m[1] !== undefined) {
        const id = Number(m[1]);
        inline.push({ type: 'mention', attrs: { id, label: nameById.get(id) ?? '알 수 없음' } });
      } else {
        inline.push({ type: 'image', attrs: { src: m[3], alt: m[2] } });
      }
      last = m.index + m[0].length;
    }
    if (last < line.length) inline.push({ type: 'text', text: line.slice(last) });
    return inline.length > 0 ? { type: 'paragraph', content: inline } : { type: 'paragraph' };
  });
  return { type: 'doc', content };
}

/** 멘션 id 글자가 숫자로 읽었다가 다시 써도 같은가 — 앞 0(`007`)·안전한 정수 범위를 넘는 숫자는 아니다. */
function isExactMentionId(digits: string): boolean {
  const id = Number(digits);
  return Number.isSafeInteger(id) && String(id) === digits;
}

/** 본문 모드에서 이미지 노드로 받을 이미지 마크다운인지 — 이 프로젝트 경로이고, 저장할 때 같은 글자로 다시 써지는 모양이어야 한다. */
function isBodyModeImage(m: RegExpExecArray, projectKey: string): boolean {
  return m[4] === projectKey && imageMarkdown(m[2], m[3]) === m[0];
}
