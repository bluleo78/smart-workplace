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
import { mayContainIssueKey, renderIssueKeys, type RenderIssueRef } from '@/lib/issueKeyRefs';

export type { RenderMention };

interface Props {
  body: string;
  mentions: MentionUser[];
  renderMention: RenderMention;
  linkTestId?: string;
  /** WP-1237: 평문 이슈 키(「WP-12」)를 그리는 함수 — 주면 코드·링크·URL·멘션 밖의 키를 이 함수로 그린다. 없으면 글자 그대로. */
  renderIssueRef?: RenderIssueRef;
}

export function ChatMarkdownText({ body, mentions, renderMention, linkTestId, renderIssueRef }: Props) {
  const tree = useMemo(() => parseChatMarkdown(body).tree, [body]);
  const byId = useMemo(() => new Map(mentions.map((m) => [m.id, m])), [mentions]);
  // URL 이 아닌 글자 조각을 그리는 함수 — 글 조각마다 새로 만들지 않게 컴포넌트에서 한 번 만든다.
  // 본문에 키 모양 글자가 없으면(대부분의 메시지) 아예 주지 않아 이슈 키 나누기를 통째로 건너뛴다.
  const renderPlain = useMemo(
    () =>
      renderIssueRef && mayContainIssueKey(body)
        ? (s: string, k: string) => renderIssueKeys(s, renderIssueRef, k)
        : undefined,
    [renderIssueRef, body],
  );
  const ctx: Ctx = { byId, renderMention, linkTestId, renderPlain };

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
  /** URL 이 아닌 글자 조각 그리기(이슈 키 링크, WP-1237) — 없으면 글자 그대로. */
  renderPlain?: (text: string, key: string) => ReactNode;
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

/** 글 조각 — 멘션 토큰은 칩, 나머지는 맨 URL 링크(링크 안이면 글 그대로). URL 이 아닌 글자 속 이슈 키는 renderIssueRef 로(WP-1237). */
function renderText(text: string, ctx: Ctx, key: string, inLink: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  // URL 로 먼저 나눈 뒤(LinkedText) 남은 글자에서만 키를 찾는다 — 「https://x/WP-12」 의 키는 링크 주소의 일부라 그대로 둔다.
  const piece = (s: string, k: string) =>
    inLink ? s : <LinkedText key={k} text={s} linkTestId={ctx.linkTestId} renderPlain={ctx.renderPlain} />;
  for (const m of text.matchAll(MENTION_TOKEN)) {
    if (m.index > last) out.push(piece(text.slice(last, m.index), `${key}t${last}`));
    out.push(ctx.renderMention(mentionSeg(ctx.byId, Number(m[1])), `${key}m${m.index}`));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(piece(text.slice(last), `${key}t${last}`));
  return out;
}
