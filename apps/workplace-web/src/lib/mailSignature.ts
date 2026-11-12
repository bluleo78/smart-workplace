// 메일 서명 블록 문자열 도구(WP-1517) — 작성창 본문 HTML 안의 서명 블록(`<div data-mail-signature="">…</div>`)을 넣고·나누고·바꾼다.
// 작성창(Tiptap)은 서명을 원자 노드 하나로 들고 getHTML() 이 이 블록 모양으로 내므로, 자동 넣기·AI 초안 교체·보낼 때 이미지 사본이
// 모두 문자열 단계에서 같은 규칙을 쓴다. 새 메일 본문은 「빈 줄 하나 + 서명」으로 끝나고 `--` 구분선은 없다(승인된 UX).
import { imgSrcIdPattern, imgSrcIds, replaceImgSrcIds } from '@/lib/htmlImgTag';
import type { ComposeMode } from '@/types/mailDraft';
import type { MailSignature } from '@/types/mailSignature';

/** 서명 블록 표시 속성 — 작성창 노드의 parseHTML·renderHTML 과 같은 이름. */
export const SIGNATURE_ATTR = 'data-mail-signature';

/** 서명 이미지 경로 — 서버(MailSignatureController)가 PUT 때 이미지를 저장하고 src 를 이 모양으로 바꾼다. */
const SIGNATURE_IMAGE_PATH = String.raw`/api/v1/mail/signature/images/(\d+)`;
const SIGNATURE_IMAGE_SRC = new RegExp(`^${SIGNATURE_IMAGE_PATH}$`);
/**
 * getHTML()·서버 정리 결과(jsoup)의 <img> src(큰따옴표)에서 서명 이미지 경로만 찾는다(imgSrcIdPattern).
 * 앞 속성 값에 `>` 가 있어도(alt="Logo > Co") 놓치지 않게 따옴표 값을 건너뛴다.
 */
const SIGNATURE_IMG_SRC_ATTR = imgSrcIdPattern(SIGNATURE_IMAGE_PATH);

/** 서명 이미지 id → src. */
export function signatureImageSrc(id: number): string {
  return `/api/v1/mail/signature/images/${id}`;
}

/** src 가 내 서명 이미지 경로인가 — 인증 요청(blob·data URI)으로 받아 그릴 대상을 가른다. */
export function isSignatureImageSrc(src: string | null | undefined): boolean {
  return src != null && SIGNATURE_IMAGE_SRC.test(src);
}

/** 본문이 참조하는 서명 이미지 id(처음 나온 순서, 중복 없음) — 보낼 때 사본(stage)을 만들 대상이다. */
export function signatureImageIds(html: string): number[] {
  return imgSrcIds(SIGNATURE_IMG_SRC_ATTR, html);
}

/** map 에 있는 서명 이미지 src 만 새 값(보통 작성창 업로드 경로)으로 바꾼다. 없는 id 는 그대로 둔다. */
export function replaceSignatureImageSrcs(html: string, map: ReadonlyMap<number, string>): string {
  return replaceImgSrcIds(SIGNATURE_IMG_SRC_ATTR, html, (id) => map.get(id) ?? null);
}

/** 서명 HTML 을 작성창 서명 블록으로 감싼다. */
export function signatureBlockHtml(sigHtml: string): string {
  return `<div ${SIGNATURE_ATTR}="">${sigHtml}</div>`;
}

/** 이미 만든 서명 블록을 본문 뒤에 붙인다 — 빈 본문이면 커서 줄 + 빈 줄, 아니면 빈 줄 하나를 사이에 둔다. */
function joinBlock(bodyHtml: string, block: string): string {
  const empty = bodyHtml === '' || bodyHtml === '<p></p>';
  return empty ? `<p></p><p></p>${block}` : `${bodyHtml}<p></p>${block}`;
}

/**
 * 본문 끝에 서명을 붙인다. 새 메일(빈 본문)은 쓸 줄 하나와 빈 줄 하나 뒤에 서명이 오고,
 * 본문이 있으면(AI 초안 등) 빈 줄 하나를 사이에 둔다.
 */
export function appendSignature(bodyHtml: string, sigHtml: string): string {
  return joinBlock(bodyHtml, signatureBlockHtml(sigHtml));
}

/** 서명 블록 바로 앞 「빈 줄」인가 — Tiptap 의 빈 문단은 `<p></p>`(붙여 넣은 글은 `<p><br></p>` 일 수 있다). */
function isEmptyParagraph(el: Element | null): el is Element {
  return el != null && el.tagName === 'P' && (el.innerHTML === '' || el.innerHTML === '<br>');
}

/**
 * 본문과 서명 블록을 나눈다(`<template>` 로 파싱 — 스크립트가 돌거나 이미지를 받지 않는다).
 * 서명 블록이 여럿이면(같은 작성창에서 복사해 붙임) 마지막 것을 block 으로 하고 나머지는 모두 뺀다.
 * block 바로 앞의 빈 문단 하나도 뺀다(appendSignature 가 넣은 간격). 서명이 없으면 block 은 null 이고 body 는 원문 그대로다.
 */
export function splitSignature(html: string): { body: string; block: string | null } {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  // 서명 블록 안에 또 블록이 있어도 바깥 것만 센다.
  const blocks = Array.from(tpl.content.querySelectorAll(`[${SIGNATURE_ATTR}]`)).filter(
    (el) => !el.parentElement?.closest(`[${SIGNATURE_ATTR}]`),
  );
  const last = blocks.at(-1);
  if (!last) return { body: html, block: null };
  const block = last.outerHTML;
  // 마지막 블록 앞에서 다른 서명 블록을 건너뛴 첫 형제가 빈 문단이면 그것이 간격이다.
  let prev = last.previousElementSibling;
  while (prev && blocks.includes(prev)) prev = prev.previousElementSibling;
  if (isEmptyParagraph(prev)) prev.remove();
  for (const b of blocks) b.remove();
  return { body: tpl.innerHTML, block };
}

/**
 * 본문을 새 내용으로 바꾸되 지금 서명 블록은 끝에 그대로 다시 붙인다 — AI 초안·개선본이 서명을 지우거나 고치지 않게.
 * 서명이 없으면 새 본문 그대로.
 */
export function replaceBodyKeepingSignature(currentHtml: string, newBodyHtml: string): string {
  const { block } = splitSignature(currentHtml);
  return block == null ? newBodyHtml : joinBlock(newBodyHtml, block);
}

/**
 * 작성창을 열 때 서명을 자동으로 넣는가. 처음 여는 작성(임시저장 id 없음·저장 실패로 다시 연 것 아님)이고 서명이 있으며,
 * 새 메일이면 autoNew, 답장·전달이면 autoReply 가 켜져 있을 때만 넣는다 — 임시저장을 다시 열면 저장된 본문 그대로 보인다.
 */
export function shouldAutoInsertSignature(
  draft: { mode: ComposeMode; draftId?: number | null; unsaved?: boolean },
  sig: MailSignature | undefined,
): boolean {
  if (draft.draftId != null || draft.unsaved) return false;
  if (!sig || sig.html === '') return false;
  return draft.mode === 'new' ? sig.autoNew : sig.autoReply;
}

/** 줄을 나누는 블록 요소 — 앞뒤에 줄바꿈을 둔다(Outlook 서명은 p·div·표 줄로 짜여 있다). */
const TEXT_BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'TR', 'TABLE', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
/** 글자가 없는 요소 — 안의 글(스타일 규칙 등)을 읽지 않는다. */
const TEXT_SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'HEAD', 'TITLE']);

/**
 * HTML 조각을 평문으로 — 작성창 서명 노드의 bodyText(renderText)와, 서명을 뺀 AI 검토(코칭) 요청 본문의 bodyText 에 쓴다. `<template>` 로 파싱해 스크립트·이미지가 돌지 않는다.
 * 블록 요소마다 줄을 나누고, 표 칸 사이는 공백 하나, 빈 줄은 둘까지만 남긴다(메일 평문 파트에 서명이 읽히는 모양이면 된다).
 */
export function htmlToPlainText(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  let out = '';
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? '').replace(/\s+/g, ' ');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName;
    if (TEXT_SKIP_TAGS.has(tag)) return;
    if (tag === 'BR') {
      out += '\n';
      return;
    }
    const block = TEXT_BLOCK_TAGS.has(tag);
    if (block && out !== '' && !out.endsWith('\n')) out += '\n';
    node.childNodes.forEach(visit);
    if (block) out += '\n';
    else if (tag === 'TD' || tag === 'TH') out += ' ';
  };
  tpl.content.childNodes.forEach(visit);
  return out
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
