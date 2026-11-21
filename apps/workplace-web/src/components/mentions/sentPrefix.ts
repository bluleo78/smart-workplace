import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * 전송 성공 시 입력창에서 무엇을 지울지 판정한다(WP-1923).
 *
 * 전송을 시작할 때의 문서(sent)와 성공 시점의 문서(current)를 견줘, 전송 중 새로 입력한 글자를 지우지 않게 한다.
 * - 'same'  : 두 문서가 같다 → 전부 비운다.
 * - number  : sent 가 current 의 앞부분이다(뒤에 이어 쓰거나 새 문단을 더함) → current 의 0~그 위치를 지우면 남은 글자만 남는다.
 *             차이 시작점이 문단 경계면 그 경계 뒤까지 포함돼 빈 문단이 남지 않는다.
 *             이어 쓴 글이 줄바꿈(Shift+Enter 의 hardBreak·코드 블록 안의 \n)으로 시작하면 그 줄바꿈 하나까지 지운다 — 남은 글 앞에 빈 줄이 남지 않게.
 * - null    : 보낸 부분이 바뀌었다 → 아무것도 지우지 않는다(글자를 잃는 것보다 남는 쪽이 안전).
 */
export function sentPrefixEnd(sent: PMNode, current: PMNode): 'same' | number | null {
  const start = sent.content.findDiffStart(current.content);
  if (start == null) return 'same';
  // 차이 시작점 뒤로 sent 에 글자·leaf(멘션 등)가 남아 있으면 보낸 부분이 바뀐 것이다(닫는 경계뿐이어야 앞부분).
  let hasRemainder = false;
  sent.nodesBetween(start, sent.content.size, (node) => {
    if (node.isText || node.isLeaf) hasRemainder = true;
    return !hasRemainder;
  });
  return hasRemainder ? null : skipLeadingBreak(current, start);
}

/**
 * pos 바로 뒤의 줄바꿈 하나(hardBreak 노드 또는 텍스트 맨 앞의 \n)를 건너뛴 위치(WP-1923 리뷰 후속).
 * 보낸 글과 이어 쓴 글을 가르는 줄바꿈 하나만 지운다 — 그 뒤 줄바꿈은 사용자가 일부러 띄운 빈 줄일 수 있다.
 */
function skipLeadingBreak(doc: PMNode, pos: number): number {
  const next = doc.resolve(pos).nodeAfter;
  if (next?.type.name === 'hardBreak') return pos + next.nodeSize;
  if (next?.isText && next.text?.startsWith('\n')) return pos + 1;
  return pos;
}
