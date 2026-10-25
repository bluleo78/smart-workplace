// 메일 본문 이미지 노드(WP-947) — 붙여 넣은 화면 캡처를 본문 그 자리에 보여 준다.
// src 는 작성창 업로드 경로(`/api/v1/files/{id}/content`)이고, 보낼 때 cid: 로 바뀐다(lib/mailPastedImages).
// 업로드 중에는 src 없이 uploadId 만 가진 자리표시로 들어가고, 끝나면 같은 노드에 src 를 채운다(settleMailImages).
// 올리는 중 판정은 이슈 코멘트 이미지(richImageNode)의 hasPendingImage 를 그대로 쓴다(노드 이름이 같은 'image').
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

import { isPastedImageSrc } from '@/lib/mailPastedImages';

import { createUploadImage } from '../mentions/richImageNode';
import { MailImageNodeView } from './MailImageNodeView';

/** 메일 본문 이미지 — 붙여 넣은 이미지 경로만 받는다(임시저장을 다시 열 때도 같은 규칙으로 되살린다). */
export const MailImage = createUploadImage(isPastedImageSrc, MailImageNodeView);

/** 끝난 업로드 결과 — 이미지면 src·alt, 실패면 null(자리표시를 지운다). */
export type PastedImageResult = { src: string; alt: string } | null;

/**
 * 결과가 나온 자리표시를 모두 채우거나 지운다 — 실행 취소 기록에 남기지 않는다.
 * 메일 편집기는 실행 취소 기록이 있어(이슈 코멘트 입력창과 다르다) 업로드를 마친 뒤 Ctrl+Z·Ctrl+Y 로 자리표시가 되살아날 수 있다.
 * 그래서 결과를 업로드 id 별로 기억해 두고 문서가 바뀔 때마다 다시 맞춘다 — 되살아난 자리표시도 곧바로 그림(또는 삭제)으로 돌아가,
 * 「올리는 중」이 영영 남아 보내기가 막히지 않는다.
 */
export function settleMailImages(editor: Editor, results: ReadonlyMap<string, PastedImageResult>) {
  if (editor.isDestroyed || results.size === 0) return;
  const targets: { pos: number; node: PMNode; result: PastedImageResult }[] = [];
  editor.state.doc.descendants((node, pos) => {
    const id = node.type.name === 'image' ? (node.attrs.uploadId as string | null) : null;
    if (id && results.has(id)) targets.push({ pos, node, result: results.get(id) ?? null });
  });
  if (targets.length === 0) return;
  const tr = editor.state.tr;
  // 뒤에서부터 고쳐 앞 노드의 위치가 밀리지 않게 한다.
  for (const { pos, node, result } of targets.reverse()) {
    if (result) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...result, uploadId: null });
    else tr.delete(pos, pos + node.nodeSize);
  }
  editor.view.dispatch(tr.setMeta('addToHistory', false));
}
