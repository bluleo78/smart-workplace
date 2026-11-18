/**
 * 작성창 원문 블록을 「바로 앞 원문」과 「지난 원문」으로 자르는 순수 함수(WP-1747).
 *
 * 여러 번 오간 메일에 답장하면 원문 블록에 지난 원문까지 길게 보여 바로 앞 원문을 찾기 어렵다.
 * 첫 지난 원문 표시에서 둘로 잘라, 작성창이 지난 원문을 접어 둘 수 있게 한다.
 * 표시만 바꾸는 용도다 — 발송 본문(draft.quote.html)은 이 함수의 결과를 쓰지 않는다.
 */

import { hasVisibleText } from '@/lib/visibleText';

/** 자른 결과 — recent 는 바로 앞 원문(우리 머리 포함), older 는 지난 원문, count 는 지난 원문 통 수. */
export interface OlderQuoteSplit {
  recent: string;
  older: string;
  count: number;
}

/** 「-----Original Message-----」·「----- 원본 메시지 -----」 줄. 서버 NewContentExtractor.ORIGINAL_MESSAGE 와 같다. */
const ORIGINAL_MESSAGE = /^-{2,}\s*(original message|원본 메시지)\s*-{2,}$/i;

/** 옛 우리 답장 머리 — blockquote 첫 줄이 「… 님이 작성:」. 웹에만 있는 표시(서버는 줄 단위 KO_WROTE 로 따로 본다). */
const OLD_WP_HEADER = /^[^\n]*님이 작성:/;

/** 인용 머리 줄 — 서버 NewContentExtractor.ON_WROTE·KO_WROTE 와 같은 모양. 표시 바로 앞 블록이 이 한 줄이면 머리로 본다. */
const ON_WROTE = /^On\s.+\bwrote:$/i;
const KO_WROTE = /^.+님이 작성:$/;

/** 인용 머리 후보 블록의 글자 길이 상한 — 머리는 한 줄이다. 긴 블록의 textContent 를 통째로 정규식에 걸지 않으려는 것. */
const ATTRIBUTION_MAX_LENGTH = 500;

/** 앞쪽 글자를 모을 때 멈추는 블록 경계 태그. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'BLOCKQUOTE', 'TABLE', 'UL', 'OL', 'LI', 'PRE', 'HR',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

/** recent 끝에서 비었으면 함께 지우는 감싸기 태그 — 표 칸·이미지 같은 구조 요소는 비어도 남긴다. */
const REMOVABLE_WHEN_EMPTY = new Set(['DIV', 'P', 'SPAN', 'FONT', 'B', 'I', 'U', 'BLOCKQUOTE', 'PRE']);

/** 화면에 글자로 보이지 않는 요소 — 바닥 답장 판정에서 이 안의 글자는 세지 않는다. */
const INVISIBLE_TAGS = new Set(['STYLE', 'SCRIPT', 'TEMPLATE']);

/** 공백·제로폭 문자만 있는 글자 노드인지 — 공용 hasVisibleText 로 본다(trim 은 제로폭 공백을 글자로 센다). */
const isBlank = (node: Node) => !hasVisibleText(node.textContent ?? '');

/**
 * 표시 종류.
 * - self: 표시 요소 자신이 지난 원문 전체를 품는다(blockquote type=cite, div.gmail_quote·wp_quote, 옛 우리 머리 blockquote).
 *   그래서 표시 뒤(요소 밖)에 글이 있으면 그것은 지난 원문이 아니라 인용 아래에 쓴 답이다.
 * - header: 머리만 있고 지난 원문은 그 뒤 형제로 이어진다(Outlook divRplyFwdMsg, Original Message 줄). 표시부터 끝까지가 지난 원문이다.
 */
type MarkerKind = 'self' | 'header';

interface Marker {
  node: Node;
  kind: MarkerKind;
}

/**
 * 요소 앞쪽 글자 — 첫 br·블록 요소를 만나기 전까지의 글자만 모은다.
 * 옛 우리 머리는 「홍길동 님이 작성:<br>」로 blockquote 를 연다. textContent 전체로 보면 글 중간의 「님이 작성:」까지
 * 걸리므로 첫 줄만 본다. 첫 줄에서 멈추므로 큰 blockquote 에서도 싸다.
 */
function leadingText(el: Element): string {
  let out = '';
  // 재귀로 인라인 요소 안까지 훑고, 경계를 만나면 false 를 돌려 멈춘다
  const walk = (node: Node): boolean => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? '';
        // 글자 안 줄바꿈도 첫 줄의 끝이다
        if (out.includes('\n')) return false;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as Element).tagName;
        if (tag === 'BR' || BLOCK_TAGS.has(tag)) return false;
        if (!walk(child)) return false;
      }
    }
    return true;
  };
  walk(el);
  return out.trimStart();
}

/**
 * 요소가 지난 원문 표시인지 태그·속성만으로 본다(글자 전체를 읽지 않는다 — 요소마다 textContent 를 읽으면 제곱 비용이다).
 * 서버 `NewContentExtractor.HTML_QUOTE_STARTS` 와 같은 목록 — 한쪽을 고치면 다른 쪽도 고친다.
 * - div id `divRplyFwdMsg*`(Outlook, 머리) · div class `gmail_quote`/`wp_quote`(Gmail·우리 앱) · blockquote type `cite*`(Apple·Thunderbird)
 * - (웹에만) 첫 줄이 「… 님이 작성:」인 blockquote — 옛 우리 답장 머리
 * Original Message 줄은 글자 표시라 여기서 보지 않고 findMarkers 의 글자 노드 훑기에서 본다.
 */
function elementMarkerKind(el: Element): MarkerKind | null {
  const tag = el.tagName;
  if (tag === 'DIV') {
    if (el.id.toLowerCase().startsWith('divrplyfwdmsg')) return 'header';
    if (el.classList.contains('gmail_quote') || el.classList.contains('wp_quote')) return 'self';
  }
  if (tag === 'BLOCKQUOTE') {
    if ((el.getAttribute('type') ?? '').toLowerCase().startsWith('cite')) return 'self';
    if (OLD_WP_HEADER.test(leadingText(el))) return 'self';
  }
  return null;
}

/**
 * 글자 노드 안에서 Original Message 줄이 시작하는 위치들(글자 노드 안 오프셋). 서버처럼 줄 단위로 본다 —
 * `<pre>` 안처럼 한 글자 노드에 여러 줄이 있으면 그 줄의 시작 위치에서 잘라야 하기 때문이다.
 */
function originalMessageOffsets(text: string): number[] {
  const offsets: number[] = [];
  // 표시 줄은 대시가 둘 이상 있어야 한다 — 대부분의 글자 노드는 줄로 나누지 않고 넘긴다
  if (!text.includes('--')) return offsets;
  let start = 0;
  for (const line of text.split('\n')) {
    if (ORIGINAL_MESSAGE.test(line.trim())) offsets.push(start);
    start += line.length + 1;
  }
  return offsets;
}

/**
 * 범위 안의 지난 원문 표시를 문서 순서로 모은다 — TreeWalker 한 번으로 요소(태그·속성)와 글자 노드(Original Message 줄)를 함께 본다.
 * Original Message 줄이 글자 노드 중간에 있으면 Text.splitText 로 그 줄 앞에서 노드를 나눠, 자를 자리가 정확히 그 줄에서 시작하게 한다.
 * (DOM 을 고치지만 이 함수 안에서 파싱한 문서라 바깥에 영향이 없다.)
 */
function findMarkers(scope: Element): Marker[] {
  const doc = scope.ownerDocument;
  const markers: Marker[] = [];
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const kind = elementMarkerKind(n as Element);
      if (kind) markers.push({ node: n, kind });
      continue;
    }
    const text = n as Text;
    const offsets = originalMessageOffsets(text.data);
    if (offsets.length === 0) continue;
    if (offsets[0] > 0) {
      // 줄 앞 글자를 떼어 둔다 — 나뉜 뒤쪽 노드는 바로 다음 형제라 걷기가 다음 차례에 그것을 표시로 본다
      text.splitText(offsets[0]);
      continue;
    }
    markers.push({ node: text, kind: 'header' });
    // 같은 노드에 줄이 더 있으면 다음 줄 앞에서 나눠 다음 차례에 따로 센다
    if (offsets.length > 1) text.splitText(offsets[1]);
  }
  return markers;
}

/** a 가 b 보다 문서 순서상 앞인지(조상 포함 안 함 — 조상은 따로 거른다). */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * 찾는 범위 — body 의 첫 요소가 표시이고 그 앞에 글자가 없으면(buildQuote 의 우리 감싸기) 그 안에서만 찾는다.
 * 감싸기 자체에서 자르면 바로 앞 원문이 비어 버리기 때문이다.
 */
function searchScope(body: HTMLElement): Element {
  const first = body.firstElementChild;
  if (!first || !elementMarkerKind(first)) return body;
  for (let node = body.firstChild; node && node !== first; node = node.nextSibling) {
    // first 앞은 요소가 아닌 노드(글자·주석)뿐이라 textContent 가 싸다
    if (!isBlank(node)) return body;
  }
  return first;
}

/**
 * Gmail 한 단계 안의 두 번째 표시인지 본다 — 이런 표시는 통 수에 넣지 않는다.
 * Gmail 은 단계마다 `div.gmail_quote` 안에 머리(`.gmail_attr`)와 `blockquote.gmail_quote` 를 함께 둔다.
 * 가장 가까운 표시 조상 안에서 이 표시 앞의 글자가 모두 공백이거나 `.gmail_attr` 안이면 같은 단계로 본다.
 * 조상 전체 textContent 를 읽지 않고 글자 노드를 앞에서부터 걷다 첫 실제 글자에서 멈춘다(긴 스레드에서도 싸다).
 */
function isSameLevelAsAncestor(marker: Node, scope: Element, markerNodes: ReadonlySet<Node>): boolean {
  // 표시 판정은 findMarkers 가 이미 했다 — 조상마다 다시 판정하지 않고 모은 집합으로 본다
  let ancestor = marker.parentElement;
  while (ancestor && ancestor !== scope && !markerNodes.has(ancestor)) ancestor = ancestor.parentElement;
  if (!ancestor || ancestor === scope) return false;
  const walker = marker.ownerDocument!.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    // 이 표시에 닿으면(표시 자신·그 안이거나 뒤) 그만 본다
    if (marker.contains(t) || !precedes(t, marker)) break;
    if (isBlank(t)) continue;
    if (t.parentElement?.closest('.gmail_attr')) continue;
    return false;
  }
  return true;
}

/**
 * self 표시 뒤(표시 요소 밖, 범위 안)에 보이는 글자가 있는지 — 있으면 인용 아래에 쓴 답(바닥 답장)이다.
 * 그 답을 지난 원문으로 접어 숨기면 바로 앞 원문의 실제 내용이 안 보이게 되므로 자르지 않는다.
 */
function hasTextAfter(marker: Node, scope: Element): boolean {
  // 표시 하위를 건너뛴 다음 노드 — 표시나 조상의 다음 형제
  let start: Node | null = null;
  for (let n: Node | null = marker; n && n !== scope; n = n.parentNode) {
    if (n.nextSibling) {
      start = n.nextSibling;
      break;
    }
  }
  if (!start) return false;
  const visible = (t: Node) => !isBlank(t) && !INVISIBLE_TAGS.has(t.parentElement?.tagName ?? '');
  if (start.nodeType === Node.TEXT_NODE && visible(start)) return true;
  const walker = scope.ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  walker.currentNode = start;
  // start 가 요소면 그 하위부터, 글자면 다음 글자부터 문서 순서로 범위 끝까지 본다
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (visible(t)) return true;
  }
  return false;
}

/** 공백 글자·br·주석을 건너뛴 앞 형제. */
function previousMeaningfulSibling(node: Node): Node | null {
  for (let prev = node.previousSibling; prev; prev = prev.previousSibling) {
    if (prev.nodeType === Node.TEXT_NODE && isBlank(prev)) continue;
    if (prev.nodeType === Node.COMMENT_NODE) continue;
    if (prev.nodeType === Node.ELEMENT_NODE && (prev as Element).tagName === 'BR') continue;
    return prev;
  }
  return null;
}

/**
 * 자를 자리 — 표시 바로 앞이 인용 머리(「On … wrote:」·「… 님이 작성:」·Thunderbird moz-cite-prefix)면 그 머리부터 자른다.
 * 그러지 않으면 머리 한 줄이 바로 앞 원문 끝에 덩그러니 남고, 지난 원문은 누가 쓴 것인지 모르게 된다.
 */
function cutStart(marker: Node): Node {
  const prev = previousMeaningfulSibling(marker);
  if (!prev) return marker;
  if (prev.nodeType === Node.ELEMENT_NODE && (prev as Element).classList.contains('moz-cite-prefix')) return prev;
  const text = prev.textContent ?? '';
  if (text.length > ATTRIBUTION_MAX_LENGTH) return marker;
  const line = text.trim();
  return ON_WROTE.test(line) || KO_WROTE.test(line) ? prev : marker;
}

/**
 * recent 끝(가장 깊은 마지막 자손 쪽)의 빈 글자·br·hr 를 지운다.
 * Outlook 은 divRplyFwdMsg 바로 앞에 hr 을 두므로, 지우지 않으면 바로 앞 원문 끝에 구분선·빈 줄이 남는다.
 */
function trimTrailing(node: Node): void {
  for (let last = node.lastChild; last; last = node.lastChild) {
    if (last.nodeType !== Node.ELEMENT_NODE) {
      // 보이는 글자에서 멈추고, 빈 글자·주석은 지우고 계속 본다
      if (last.nodeType === Node.TEXT_NODE && !isBlank(last)) return;
      last.remove();
      continue;
    }
    const el = last as Element;
    if (el.tagName === 'BR' || el.tagName === 'HR') {
      el.remove();
      continue;
    }
    trimTrailing(el);
    // 안을 비워 빈 감싸기만 남았으면 그것도 지우고 앞 형제를 본다
    if (el.childNodes.length === 0 && REMOVABLE_WHEN_EMPTY.has(el.tagName)) {
      el.remove();
      continue;
    }
    return;
  }
}

/** body 에서 node(요소·글자 노드) 까지의 자식 번호 경로 — 복제본에서 같은 자리를 찾는 데 쓴다. */
function pathFrom(root: Node, node: Node): number[] {
  const path: number[] = [];
  for (let n: Node = node; n !== root; n = n.parentNode!) {
    path.unshift(Array.prototype.indexOf.call(n.parentNode!.childNodes, n));
  }
  return path;
}

/**
 * body 를 깊은 복제한 뒤 자를 자리(path — 요소든 글자 노드든)의 앞쪽 또는 뒤쪽을 지운 HTML.
 * keep='before' 는 자를 자리와 그 뒤(조상마다 뒤 형제)를 지우고, 'from' 은 자를 자리 앞(조상마다 앞 형제)을 지운다.
 * Range.cloneContents 와 같은 결과(조상 감싸기는 양쪽에 남는다)지만 Range 를 쓰지 않는다 —
 * 페이지 테스트의 happy-dom 이 setEndBefore 경계 비교를 잘못해 빈 범위를 돌려주었다(WP-1747).
 */
function cutAt(body: HTMLElement, path: number[], keep: 'before' | 'from'): string {
  const clone = body.cloneNode(true) as HTMLElement;
  let parent: Node = clone;
  for (let depth = 0; depth < path.length; depth++) {
    const index = path[depth];
    const children = Array.from(parent.childNodes);
    const isCut = depth === path.length - 1;
    if (keep === 'before') {
      // 자를 자리 자신(마지막 단계)과 이 단계의 뒤 형제를 지운다
      children.slice(isCut ? index : index + 1).forEach((c) => c.parentNode?.removeChild(c));
    } else {
      children.slice(0, index).forEach((c) => c.parentNode?.removeChild(c));
    }
    if (isCut) break;
    parent = children[index];
  }
  if (keep === 'before') trimTrailing(clone);
  return clone.innerHTML;
}

/**
 * 원문 HTML 을 첫 지난 원문 표시에서 둘로 자른다. 지난 원문 표시가 없으면 null(자르지 않고 원문 전체를 쓴다).
 * 첫 표시가 self 표시인데 그 뒤에 글이 있으면(인용 아래에 쓴 답) 역시 null 이다 — 답을 접어 숨기지 않는다.
 * 조상 경로를 따라 복제본을 잘라 내므로 표·font 같은 감싸기 안 깊이 있는 표시에서 잘라도 양쪽 모두 조상 감싸기(서식)가 남는다.
 */
export function splitOlderQuotes(html: string): OlderQuoteSplit | null {
  if (!html.trim()) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  const scope = searchScope(body);

  // 범위 안 표시를 문서 순서로 — 첫 표시가 자를 자리다
  const markers = findMarkers(scope);
  const first = markers[0];
  if (!first) return null;
  if (first.kind === 'self' && hasTextAfter(first.node, scope)) return null;

  // 통 수: 첫 표시와 그 뒤 표시 중 Gmail 단계 안 두 번째 표시를 뺀 수
  const markerNodes = new Set(markers.map((m) => m.node));
  const count = markers.filter((m) => !isSameLevelAsAncestor(m.node, scope, markerNodes)).length;

  // body 전체 기준으로 잘라 우리 감싸기(scope)도 양쪽에 남긴다 — 서식·클래스 유지
  const path = pathFrom(body, cutStart(first.node));
  return {
    recent: cutAt(body, path, 'before'),
    older: cutAt(body, path, 'from'),
    count,
  };
}
