// 사람이 쓴 채팅 메시지 본문 렌더(WP-101) — 팀 채팅(MessageRow)·이슈 채팅(ChatMessageRow) 공용. AI 메시지는 MarkdownMessage 그대로.
// 파서는 입력창 복원과 같은 chatMarkdown. 서식 없는 예전 평문은 예전과 같은 DOM 이 되도록 그린다:
//  - 루트 문단은 블록 요소로 감싸지 않고 글자 + '\n' 으로 잇는다 — 감싸는 div 의 whitespace-pre-wrap 이 줄바꿈·빈 줄·들여쓰기를 그대로 보이고,
//    끝에 붙는 「(수정됨)」 도 예전처럼 마지막 줄에 이어진다.
//  - 목록·코드 블록만 블록 요소. 그 앞뒤 빈 줄은 빈 줄 높이의 자리로 채운다.
// 맨 URL 은 기존 LinkedText 규칙, 멘션 토큰은 호출처가 주는 칩(화면마다 색이 다르다).
import type { PhrasingContent, RootContent } from 'mdast';
import { Fragment, type ReactNode, useMemo } from 'react';

import { LinkedText, TextLink } from '@/components/LinkedText';
import { blankLinesBetween, MENTION_TOKEN, parseChatMarkdown, safeHref } from '@/components/mentions/chatMarkdown';
import { mentionSeg, type RenderMention } from '@/components/mentions/parseMessageSegments';
import type { MentionUser } from '@/components/mentions/types';

export type { RenderMention };

interface Props {
  body: string;
  mentions: MentionUser[];
  renderMention: RenderMention;
  linkTestId?: string;
}

export function ChatMarkdownText({ body, mentions, renderMention, linkTestId }: Props) {
  const tree = useMemo(() => parseChatMarkdown(body).tree, [body]);
  const byId = useMemo(() => new Map(mentions.map((m) => [m.id, m])), [mentions]);
  const ctx: Ctx = { byId, renderMention, linkTestId };

  const out: ReactNode[] = [];
  let prev: RootContent | undefined;
  tree.children.forEach((b, i) => {
    const blanks = blankLinesBetween(prev, b);
    const inlineBoth = b.type === 'paragraph' && (prev === undefined || prev.type === 'paragraph');
    if (inlineBoth) {
      // 문단 ↔ 문단: 글자 줄바꿈 그대로(예전 평문과 같은 DOM). 첫 문단 앞 빈 줄도 '\n'.
      const nl = blanks + (prev ? 1 : 0);
      if (nl > 0) out.push('\n'.repeat(nl));
    } else if (blanks > 0) {
      // 목록·코드 블록 이웃의 빈 줄 — 블록 경계에선 '\n' 이 줄을 만들지 않아 높이로 채운다.
      out.push(<span key={`gap-${i}`} aria-hidden className="block" style={{ height: `${blanks}lh` }} />);
    }
    out.push(<Fragment key={i}>{renderBlock(b, ctx, `${i}`)}</Fragment>);
    prev = b;
  });
  return <>{out}</>;
}

interface Ctx {
  byId: Map<number, MentionUser>;
  renderMention: RenderMention;
  linkTestId?: string;
}

function renderBlock(b: RootContent, ctx: Ctx, key: string): ReactNode {
  switch (b.type) {
    case 'paragraph':
      return renderPhrasing(b.children, ctx, key, false);
    case 'list': {
      const items = b.children.map((item, i) => (
        <li key={i} className="pl-0.5">
          {item.children.map((c, k) => (
            <Fragment key={k}>
              {/* 항목 안 문단끼리는 줄바꿈으로 — 블록(목록·코드)은 스스로 줄을 연다. */}
              {k > 0 && c.type === 'paragraph' && item.children[k - 1].type === 'paragraph' ? '\n' : null}
              {renderBlock(c as RootContent, ctx, `${key}-${i}-${k}`)}
            </Fragment>
          ))}
        </li>
      ));
      return b.ordered ? (
        <ol start={b.start ?? 1} className="list-decimal pl-5" data-chat-md="ol">
          {items}
        </ol>
      ) : (
        <ul className="list-disc pl-5" data-chat-md="ul">
          {items}
        </ul>
      );
    }
    case 'code':
      return (
        <pre className="my-0.5 overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs whitespace-pre text-foreground" data-chat-md="pre">
          <code>{b.value}</code>
        </pre>
      );
    default:
      return null;
  }
}

/** 인라인 노드 → React. inLink 면 글 안 URL 을 다시 링크로 만들지 않는다. */
function renderPhrasing(nodes: PhrasingContent[], ctx: Ctx, key: string, inLink: boolean): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}.${i}`;
    switch (n.type) {
      case 'text':
        return <Fragment key={k}>{renderText(n.value, ctx, k, inLink)}</Fragment>;
      case 'break':
        return '\n';
      case 'strong':
        return (
          <strong key={k} className="font-semibold">
            {renderPhrasing(n.children, ctx, k, inLink)}
          </strong>
        );
      case 'emphasis':
        return <em key={k}>{renderPhrasing(n.children, ctx, k, inLink)}</em>;
      case 'delete':
        return (
          <del key={k} className="line-through">
            {renderPhrasing(n.children, ctx, k, inLink)}
          </del>
        );
      case 'chatUnderline':
        return (
          <u key={k} className="underline underline-offset-2">
            {renderPhrasing(n.children, ctx, k, inLink)}
          </u>
        );
      case 'inlineCode':
        return (
          <code key={k} className="rounded bg-muted px-1 py-px font-mono text-[0.85em] text-foreground">
            {n.value}
          </code>
        );
      case 'link': {
        const href = safeHref(n.url);
        const children = renderPhrasing(n.children, ctx, k, true);
        // 열 수 없는 주소(javascript: 등)는 링크로 만들지 않고 글만.
        return href ? (
          <TextLink key={k} href={href} testId={ctx.linkTestId}>
            {children}
          </TextLink>
        ) : (
          <Fragment key={k}>{children}</Fragment>
        );
      }
      default:
        return null;
    }
  });
}

/** 글 조각 — 멘션 토큰은 칩, 나머지는 맨 URL 링크(링크 안이면 글 그대로). */
function renderText(text: string, ctx: Ctx, key: string, inLink: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  const piece = (s: string, k: string) =>
    inLink ? s : <LinkedText key={k} text={s} linkTestId={ctx.linkTestId} />;
  for (const m of text.matchAll(MENTION_TOKEN)) {
    if (m.index > last) out.push(piece(text.slice(last, m.index), `${key}t${last}`));
    out.push(ctx.renderMention(mentionSeg(ctx.byId, Number(m[1])), `${key}m${m.index}`));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(piece(text.slice(last), `${key}t${last}`));
  return out;
}
