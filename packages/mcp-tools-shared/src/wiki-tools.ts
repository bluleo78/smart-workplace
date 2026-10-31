// src/wiki-tools.ts — 노트(위키) 도구. 두 앱 공유(#846, #850, #854).
// 쓰기는 스페이스 멤버십 가드를 서버가 강제하므로 확인 카드 없이 직접 실행한다.
// update_wiki_page 의 409(기준본 없음 — 만료·기록 없음·현재보다 새 version)는 그대로 throw — 자동 재시도는 하지 않는다. 동시 편집은 서버가 3-way 병합한다(WP-289).
import { z } from 'zod';
import { dropEmpty, omitKeys, truncatedView } from './compact.js';
import { htmlToText } from './html-text.js';
import type { SharedTool } from './mcp-tool.js';
import type { WikiPageRow, WikiToolClient } from './tool-client.js';

// WP-357: spaceId 로 한 스페이스 안에서만 찾는다(서버 WikiSearchController 의 spaceId — 멤버가 아니면 서버가 requireRole(VIEWER) 로 404 를 던진다).
export const searchWikiInput = z.object({
  query: z.string().min(1),
  spaceId: z.number().int().positive().optional(),
});
export const getWikiPageInput = z.object({ pageId: z.number().int().positive() });
// WP-357: 요약·판 기록은 별도 도구 없이 상세의 옵션이다 — 꺼져 있으면 추가 요청이 없다.
export const getWikiPageDetailInput = getWikiPageInput.extend({
  includeSummary: z.boolean().optional(),
  includeRevisions: z.boolean().optional(),
});
// 판 번호는 get_wiki_page 의 revisions[].version 이다(update_wiki_page 의 version 은 저장 기준 판이라 다른 값).
export const restoreWikiRevisionInput = z.object({
  pageId: z.number().int().positive(),
  version: z.number().int().min(1),
});
export const listWikiPagesInput = z.object({
  spaceId: z.number().int().positive(),
  // WP-352: 큰 스페이스의 트리가 잘렸을 때 그 페이지의 하위만 따로 펼쳐 보는 용도.
  parentId: z.number().int().positive().optional(),
});

/** 한 번에 돌려줄 트리 노드 수 상한 — 넘으면 위쪽 계층부터 이 수만큼만 담고 truncated 로 알린다(수천 페이지 스페이스의 토큰 폭주 방지). */
const MAX_WIKI_TREE_NODES = 500;
/**
 * 서버 노트 검색이 거는 상한(WikiPageService.search 의 pages.search(..., 50), 최근 수정순). 서버가 잘렸는지 알리지 않아
 * 이 수에 닿으면 더 있을 수 있다고 본다. 서버 상한을 바꾸면 이 값도 맞춘다.
 */
const SEARCH_SERVER_CAP = 50;
/** get_wiki_page 의 includeRevisions 가 싣는 판 수(최신순). 서버는 최대 200건을 주는데 판마다 편집자·사유가 있어 넘기면 잘라 revisionsOmitted 로 알린다. */
const MAX_REVISIONS = 30;
// WP-1243: 만들면서 본문도 쓸 수 있다 — body(마크다운) 또는 html(HTML 산출물을 HTML 블록 하나로). 둘 다 주면 거부한다.
// title 은 html 의 <title> 로 대신할 수 있어 스키마에서는 선택이고, 둘 다 없으면 핸들러가 거부한다.
export const createWikiPageInput = z.object({
  spaceId: z.number().int().positive(),
  title: z.string().min(1).max(255).optional(),
  parentId: z.number().int().positive().optional(),
  body: z.string().optional(),
  html: z.string().min(1).optional(),
});
// 서버가 부분 수정을 지원한다(title/body 생략 = 현재 값 유지). version 은 병합 기준(읽은 판)이라 필수.
export const updateWikiPageInput = z.object({
  pageId: z.number().int().positive(),
  version: z.number().int().min(1),
  title: z.string().max(255).optional(),
  body: z.string().optional(),
  // WP-424: upload_file 로 스테이징한 이미지 — 저장 전에 이 페이지 첨부로 묶고, 응답 images 의 url 을 본문에 쓴다.
  fileIds: z.array(z.number().int().positive()).max(10).optional(),
});

// parentId 는 생략이 아닌 명시(null=최상위)로 받는다 — 생략을 루트로 해석하면 위치만 바꾸려던 호출이 페이지를 루트로 끌어올린다.
export const moveWikiPageInput = z.object({
  pageId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable(),
  position: z.number().int().min(0).optional(),
});

/**
 * HTML 블록 펜스(WP-1243) — 소스 안 가장 긴 백틱 줄보다 한 개 더(최소 3개). 소스의 어떤 줄도 펜스를 닫지 못하게 한다.
 * 웹 노트 편집기 직렬화(packages/wiki-editor-schema 의 htmlEmbedFence)와 같은 규칙을 옮겨 둔다 — 그 패키지는 tiptap 을 peer 로 두는
 * 소스 전용 패키지라 tsc 로 dist 를 내는 이 패키지가 의존할 수 없다. 규칙을 바꾸면 두 곳을 함께 바꾼다.
 */
export function htmlEmbedFence(source: string): string {
  let longest = 0;
  for (const run of source.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * HTML 문서 → 노트 본문(WP-1243): HTML 블록 하나(```html-embed). 편집기 직렬화와 같은 모양(펜스 + 정보 문자열 + 소스 + 줄바꿈 + 펜스)이라 웹에서
 * 열고 저장해도 그대로다. 줄바꿈은 \n 으로 맞추고 끝 공백 줄은 뗀다(문서 끝 공백은 그려지는 모양과 무관).
 */
export function htmlToWikiBody(html: string): string {
  const source = html.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  const fence = htmlEmbedFence(source);
  return `${fence}html-embed\n${source}\n${fence}`;
}

/** HTML 문서의 <title> 글자(태그·엔티티를 풀고 공백을 접어 255자까지). 없거나 비면 undefined — create_wiki_page 의 title 대신 쓴다. */
export function htmlDocumentTitle(html: string): string | undefined {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  let title = m ? htmlToText(m[1]).replace(/\s+/g, ' ').trim().slice(0, 255) : '';
  // 255 에서 잘린 자리가 서로게이트 쌍(이모지 등) 한가운데면 홀로 남은 high surrogate 를 뗀다(서버 상한은 UTF-16 255자).
  if (/[\uD800-\uDBFF]$/.test(title)) title = title.slice(0, -1);
  title = title.trim();
  return title || undefined;
}

/** body·html 중 하나를 본문으로 — 둘 다 주면 어느 쪽을 뜻했는지 알 수 없어 거부한다. 둘 다 없으면 undefined(빈 페이지). */
function resolveBody(body: string | undefined, html: string | undefined): string | undefined {
  if (body !== undefined && html !== undefined) {
    throw new Error('body 와 html 은 함께 줄 수 없습니다. 마크다운 본문은 body, HTML 산출물을 그대로 넣을 때는 html 하나만 주세요.');
  }
  return html !== undefined ? htmlToWikiBody(html) : body;
}

/**
 * 노트 본문 형식·편집 규칙(WP-1243) — 본문은 마크다운에 HTML 이 섞일 수 있고(WP-1240 페이지 스타일·스타일 컨테이너, WP-1242 HTML 블록), AI 가
 * 이 HTML 을 고쳐 쓰거나 지우면 노트 모양이 깨진다.
 *
 * 도구 설명에는 짧은 요약만 싣고 전문은 get_wiki_page 응답의 bodyFormat 으로 준다 — 외부 MCP 는 도구 정의를 매 대화에 전부 싣고 그 크기에 상한이
 * 있다(tool-naming.test.ts 의 DEFINITION_TOKEN_CAP). 전문은 HTML 이 든 본문을 읽었을 때만, 곧 고치기 직전에 실려 비용이 그때만 든다.
 */
export const WIKI_BODY_FORMAT_GUIDE =
  'The body is Markdown that also holds HTML: one page stylesheet <style data-wp-style>...</style>; styled containers written as an ' +
  'opening tag line (e.g. <div class="card" style="...">, also section, article, ...), a blank line, Markdown content, a blank line, ' +
  'then the closing tag line; inline <span class/style>; and ```html-embed fenced blocks holding a full HTML document (scripts, canvas) ' +
  'shown in an isolated frame. When editing: keep the <style data-wp-style> block and container tag lines, with their blank lines, ' +
  'unchanged when changing text inside them; never edit inside an html-embed block unless asked, and keep its fence (backtick count) ' +
  'as is; write ordinary text as plain Markdown, never wrap it in HTML. To turn an HTML artifact into a note, either convert it ' +
  '(static content to Markdown, page CSS into one <style data-wp-style>, styled containers kept with their blank lines, each ' +
  'script/canvas part as an html-embed block holding a full HTML document with its own styles and scripts), or pass the raw HTML as ' +
  'create_wiki_page html to keep it whole as one html-embed block.';

/**
 * 본문에 HTML(한 줄 안에서 닫힌 태그·HTML 블록 펜스)이 있는지 — 있을 때만 get_wiki_page 가 bodyFormat 을 싣는다. 태그 모양은 API 평문 추출
 * (WikiPlainText.HTML_TAG)과 같다. 비교식이 태그로 잘못 보여도 안내가 더 실릴 뿐이라 해가 없다.
 */
export function bodyHasHtml(body: unknown): boolean {
  return typeof body === 'string' && (/<\/?[A-Za-z][\w-]*(?:\s[^<>\n]*)?\/?>/.test(body) || /^[ \t>*+\-\d.)]*`{3,}html-embed/m.test(body));
}

/** position 생략 시 보낼 값 — 서버가 0..형제수로 잘라 맨 끝에 놓는다(서버 필드가 Integer). */
const APPEND_POSITION = 2_147_483_647;

/**
 * 페이지 트리 노드 — 자식이 없으면 children 을 생략해 응답을 줄인다. hiddenChildren 은 상한 때문에 children 에 못 담은 직계 자식 수
 * (잘린 노드에만 있다 — list_wiki_pages 의 parentId 로 펼친다).
 */
export interface WikiPageNode {
  id: number;
  title: string;
  children?: WikiPageNode[];
  hiddenChildren?: number;
}

/**
 * 평면 페이지 목록(parentId·position) → 중첩 트리. 서버는 평면 목록만 주고, LLM 이 parentId 를 따라가며 계층을
 * 재구성하면 자주 틀리므로 핸들러가 조립한다. 부모가 목록에 없는 페이지(권한·정합성 문제)는 잃지 않게 최상위로 올린다.
 * rootId 를 주면 그 페이지의 하위 트리만 만든다(없는 페이지면 빈 트리).
 * maxNodes 를 주면 위쪽 계층부터 너비 우선으로 그 수만큼만 담는다 — 담긴 노드의 부모는 항상 담겨 있어 계층이 깨지지 않고,
 * 자식이 다 담기지 못한 노드에는 hiddenChildren 이 붙는다. total 은 상한 전의 전체 노드 수다.
 */
export function toWikiPageTree(rows: WikiPageRow[], opts: { rootId?: number; maxNodes?: number } = {}) {
  const ids = new Set(rows.map((r) => r.id));
  const byParent = new Map<number | null, WikiPageRow[]>();
  for (const r of rows) {
    const parent = r.parentId != null && ids.has(r.parentId) ? r.parentId : null;
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(r);
    else byParent.set(parent, [r]);
  }
  const childrenOf = (parent: number | null) => (byParent.get(parent) ?? []).sort((a, b) => a.position - b.position);
  const rootParent = opts.rootId ?? null;
  // 너비 우선으로 담을 노드를 고른다 — 상한이 없으면 전부.
  const included = new Set<number>();
  const queue = [...childrenOf(rootParent)];
  const countAll = (parent: number | null): number => childrenOf(parent).reduce((n, c) => n + 1 + countAll(c.id), 0);
  const total = countAll(rootParent);
  for (let i = 0; i < queue.length && included.size < (opts.maxNodes ?? Infinity); i++) {
    included.add(queue[i].id);
    queue.push(...childrenOf(queue[i].id));
  }
  const build = (parent: number | null): WikiPageNode[] =>
    childrenOf(parent)
      .filter((r) => included.has(r.id))
      .map(({ id, title }) => {
        const children = build(id);
        const hidden = childrenOf(id).length - children.length;
        return { id, title, ...(children.length > 0 && { children }), ...(hidden > 0 && { hiddenChildren: hidden }) };
      });
  return { items: build(rootParent), total, truncated: included.size < total };
}

/**
 * 페이지 상세 → LLM 뷰. 마지막 수정자 updatedBy 는 숫자 사용자 ID 라 내보내지 않는다(#833, WP-353).
 * 서버 응답에 수정자 이름이 없고(WikiPageDetail 은 id 만), 수정 시각 updatedAt 으로 "언제" 는 알 수 있다 — 이름을 풀려면 id→사용자
 * 일괄 조회가 필요한데 공유 도구에는 없고(구성원 조회는 검색어 기준), 이 값을 입력으로 받는 도구도 없어 서버 필드를 늘리지 않고 뺀다.
 */
export function toWikiPageView(page: Record<string, unknown>) {
  return omitKeys(page, 'updatedBy');
}

type Raw = Record<string, unknown>;

/** 서버 Person{id,name} 목록 → 이름 목록. 숫자 사용자 ID(id)는 내보내지 않는다(#833) — 이름이 없으면 그 사람은 뺀다. */
function personNames(people: unknown): string[] {
  return (Array.isArray(people) ? (people as Raw[]) : []).flatMap((p) => (typeof p?.name === 'string' ? [p.name] : []));
}

/**
 * 판 기록 응답(WikiRevisionListResponse) → LLM 뷰(WP-357). 판마다 {version, editedAt, editors(이름), reason?, aiActor?(이름)} 만 싣는다 —
 * 숫자 사용자 ID(Person.id)·스냅샷 적재 시각(createdAt)·판 제목(복원은 제목을 건드리지 않는다)은 뺀다. 현재 판(current)은 페이지 자체의 version 과
 * 같아 싣지 않는다(복원 대상도 아니다). 최신 MAX_REVISIONS 건만 담고 넘치면 빠진 수를 알린다(서버 상한이 200건).
 */
export function toRevisionsView(raw: unknown): { revisions: Raw[]; revisionsOmitted?: number } {
  const items = ((raw as { items?: Raw[] } | null)?.items ?? []) as Raw[];
  const revisions = items.slice(0, MAX_REVISIONS).map((r) =>
    dropEmpty({
      version: r.version,
      editedAt: r.editedAt,
      reason: r.reason,
      editors: personNames(r.editors),
      aiActor: (r.aiActor as Raw | null | undefined)?.name,
    }),
  );
  const omitted = items.length - revisions.length;
  return { revisions, ...(omitted > 0 && { revisionsOmitted: omitted }) };
}

/**
 * 요약 응답(WikiPageSummaryState) → LLM 뷰(WP-357). 요약이 있으면 summary, 상태가 READY 가 아니면 summaryStatus(STALE = 이후 노트가 바뀜,
 * MISSING·TOO_SHORT·UNAVAILABLE = 요약 없음)만 싣는다. 버전·시각 필드는 페이지 version 과 겹치거나 판단에 쓸 데가 없어 뺀다.
 */
export function toSummaryView(raw: unknown): Raw {
  const r = (raw ?? {}) as Raw;
  return dropEmpty({ summary: r.summary, summaryStatus: r.status === 'READY' ? undefined : r.status });
}

/** 노트 도구(list_wiki_spaces/list_wiki_pages/search_wiki/get_wiki_page/list_wiki_backlinks/create_wiki_page/update_wiki_page/move_wiki_page/restore_wiki_revision). */
export function buildWikiTools(client: WikiToolClient): SharedTool[] {
  return [
    {
      name: 'list_wiki_spaces',
      app: 'wiki',
      kind: 'read',
      description:
        'Lists wiki spaces (노트) I can access (id = spaceId); mine is type PERSONAL ("내 노트").',
      inputSchema: z.object({}),
      async handler() {
        // 스페이스 소유자 ownerId 는 숫자 사용자 ID 라 내보내지 않는다(#833, WP-353) — 내 역할은 role 로 알 수 있다.
        return JSON.stringify(((await client.listWikiSpaces()) as Record<string, unknown>[]).map((space) => omitKeys(space, 'ownerId')));
      },
    },
    {
      name: 'list_wiki_pages',
      app: 'wiki',
      kind: 'read',
      description:
        'Returns a wiki space page tree {items, total, truncated?}: nodes {id (pageId), title, children?} in sidebar order, ' +
        `max ${MAX_WIKI_TREE_NODES} breadth-first. truncated: call again with a hiddenChildren node id as parentId; total counts ` +
        'all nodes (under parentId if given). If a parent has too many direct children, use search_wiki. Unexpanded: say only part was seen.',
      inputSchema: listWikiPagesInput,
      async handler(args) {
        const { spaceId, parentId } = listWikiPagesInput.parse(args);
        const rows = await client.listWikiPages(spaceId);
        if (parentId !== undefined && !rows.some((r) => r.id === parentId)) {
          throw new Error(`parentId ${parentId} 페이지가 이 스페이스(${spaceId})에 없습니다. list_wiki_pages 트리의 id 를 쓰세요.`);
        }
        const { items, total, truncated } = toWikiPageTree(rows, { rootId: parentId, maxNodes: MAX_WIKI_TREE_NODES });
        return JSON.stringify({ items, total, ...(truncated && { truncated: true }) });
      },
    },
    {
      name: 'search_wiki',
      app: 'wiki',
      kind: 'read',
      description:
        'Searches wiki pages (노트) by title and body text in spaces I can access (or one spaceId), newest edit first: {items, truncated?} (id = pageId), ' +
        `at most ${SEARCH_SERVER_CAP}. truncated: more may exist, no next page: refine the query or say the result is partial.`,
      inputSchema: searchWikiInput,
      async handler(args) {
        const { query, spaceId } = searchWikiInput.parse(args);
        const rows = (await client.searchWikiPages(query, spaceId)) as unknown[];
        // 서버가 상한에서 조용히 자르므로 그 수에 닿으면 잘렸을 수 있다고 본다.
        return JSON.stringify(truncatedView(rows, rows.length >= SEARCH_SERVER_CAP));
      },
    },
    {
      name: 'get_wiki_page',
      app: 'wiki',
      kind: 'read',
      description:
        'Returns a wiki page (노트) by pageId: Markdown body, version (for update_wiki_page), ' +
        'bodyFormat if it has HTML. includeSummary: stored AI summary (read-only; summaryStatus STALE = changed since, ' +
        'MISSING/TOO_SHORT/UNAVAILABLE = none). includeRevisions: latest 30 revisions (version is for restore_wiki_revision).',
      inputSchema: getWikiPageDetailInput,
      async handler(args) {
        const { pageId, includeSummary, includeRevisions } = getWikiPageDetailInput.parse(args);
        // 옵션이 꺼져 있으면 추가 요청이 없다. 요약은 저장된 값을 읽기만 한다(GET — 생성은 POST 라 AI 호출이 없다).
        const [page, summary, revisions] = await Promise.all([
          client.getWikiPage(pageId),
          includeSummary ? client.getWikiPageSummary(pageId) : undefined,
          includeRevisions ? client.listWikiRevisions(pageId) : undefined,
        ]);
        const view = toWikiPageView(page as Record<string, unknown>);
        return JSON.stringify({
          ...view,
          // WP-1243: HTML 이 든 본문에만 형식·편집 규칙을 함께 준다 — 고치기 전에 반드시 읽는 응답이라 여기서 알린다.
          ...(bodyHasHtml(view.body) && { bodyFormat: WIKI_BODY_FORMAT_GUIDE }),
          ...(includeSummary && toSummaryView(summary)),
          ...(includeRevisions && toRevisionsView(revisions)),
        });
      },
    },
    {
      name: 'list_wiki_backlinks',
      app: 'wiki',
      kind: 'read',
      description:
        'Lists pages I can see that link to this wiki page (backlinks).',
      inputSchema: getWikiPageInput,
      async handler(args) {
        const { pageId } = getWikiPageInput.parse(args);
        return JSON.stringify(await client.getWikiBacklinks(pageId));
      },
    },
    {
      name: 'create_wiki_page',
      app: 'wiki',
      kind: 'write',
      hints: { destructive: false, idempotent: false },
      description:
        'Creates a wiki page in spaceId (from list_wiki_spaces), under parentId or top level; returns id and version. Optional ' +
        'body (Markdown) or html: an HTML artifact kept whole as one html-embed block (<title> = default title). Or convert it: static ' +
        'parts to Markdown, page CSS in one <style data-wp-style>, script/canvas parts as html-embed blocks (each a full HTML doc).',
      inputSchema: createWikiPageInput,
      async handler(args) {
        const { spaceId, title, parentId, body, html } = createWikiPageInput.parse(args);
        const content = resolveBody(body, html);
        const pageTitle = title ?? (html !== undefined ? htmlDocumentTitle(html) : undefined);
        if (!pageTitle) {
          throw new Error('title 이 필요합니다(html 에 <title> 이 없으면 title 을 주세요).');
        }
        const created = toWikiPageView((await client.createWikiPage(spaceId, { parentId: parentId ?? null, title: pageTitle })) as Record<string, unknown>);
        if (!content) {
          return JSON.stringify(created);
        }
        // 서버 생성 API 는 제목만 받는다 — 생성 응답의 version(서버가 기준본을 남긴다)으로 곧바로 본문을 저장한다.
        try {
          return JSON.stringify(toWikiPageView((await client.updateWikiPage(created.id as number, { version: created.version as number, body: content })) as Record<string, unknown>));
        } catch (e) {
          // 페이지는 이미 만들어졌다 — 다시 만들지 않고 update_wiki_page 로 본문만 넣게 알린다.
          const reason = e instanceof Error ? e.message : String(e);
          throw new Error(`페이지(pageId ${String(created.id)})는 만들었지만 본문 저장에 실패했습니다: ${reason} — 새로 만들지 말고 update_wiki_page 로 본문을 저장하세요.`);
        }
      },
    },
    {
      name: 'update_wiki_page',
      app: 'wiki',
      kind: 'write',
      // 본문 전체 대체(3-way 병합). AI 적용은 매번 이전 판 스냅샷을 남기고, 기준본이 만료되면 409 라 멱등으로 보지 않는다.
      hints: { destructive: true, idempotent: false },
      description:
        'Saves a wiki page title and/or body; omitted fields stay. body replaces the whole Markdown document (omitted text is deleted): ' +
        'for a partial edit send it all, copying untouched blocks and HTML byte-for-byte from get_wiki_page (no rewording or ' +
        'normalizing; see its bodyFormat). version: from ' +
        "get_wiki_page or the last save; others' later edits merge in (this request wins on overlap). 409: version unusable (over 1 " +
        'hour old, unknown or newer): re-read and reapply. fileIds: images (PNG/JPEG/GIF/WebP) staged by upload_file; reference each in ' +
        'body as ![alt](/api/v1/wiki/pages/{pageId}/attachments/{fileId}/content).',
      inputSchema: updateWikiPageInput,
      async handler(args) {
        const { pageId, fileIds, ...body } = updateWikiPageInput.parse(args);
        // WP-424: 이미지는 본문 저장 전에 묶는다 — 본문 저장이 참조된 첨부를 영구화하므로 순서가 바뀌면 이미지가 만료로 지워진다.
        // 클레임이 실패하면(만료·이미지 아님 등) 본문을 저장하지 않고 오류를 그대로 전한다.
        const claimed = fileIds?.length ? await client.claimWikiImages(pageId, fileIds) : undefined;
        const saved = toWikiPageView((await client.updateWikiPage(pageId, body)) as Record<string, unknown>);
        return JSON.stringify(claimed ? { ...saved, images: claimed.map(({ fileId, url }) => ({ fileId, url })) } : saved);
      },
    },
    {
      name: 'restore_wiki_revision',
      app: 'wiki',
      kind: 'write',
      // 본문을 그 판으로 덮어쓴다(제목은 그대로). 복원 직전 본문은 RESTORE 사유로 남아 되돌릴 수 있고, 동기화 서버 경로는 호출마다 판이 남을 수 있어 멱등으로 보지 않는다.
      hints: { destructive: true, idempotent: false },
      description:
        'Restores a wiki page body to a saved revision (version from get_wiki_page includeRevisions); title stays; the ' +
        'prior body is kept as a revision.',
      inputSchema: restoreWikiRevisionInput,
      async handler(args) {
        const { pageId, version } = restoreWikiRevisionInput.parse(args);
        return JSON.stringify(toWikiPageView((await client.restoreWikiRevision(pageId, version)) as Record<string, unknown>));
      },
    },
    {
      name: 'move_wiki_page',
      app: 'wiki',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        'Moves a wiki page with its subpages within its space (not under itself). parentId: new parent pageId, null = top level. position: sibling ' +
        'index (0 = first, omit = last).',
      inputSchema: moveWikiPageInput,
      async handler(args) {
        const { pageId, parentId, position } = moveWikiPageInput.parse(args);
        await client.moveWikiPage(pageId, { parentId, position: position ?? APPEND_POSITION });
        return 'ok';
      },
    },
  ];
}
