// 통합 검색(WP-1353)의 앱별 provider — 앱마다 기존 API 로 한 쪽씩 찾아 공통 모양(SearchHit)으로 돌려준다.
// 훅이 아닌 평범한 async 함수라 팔레트(useQuery·useInfiniteQuery)와 테스트(MSW)가 같이 쓴다. 의존(queryClient·내 id)은 createSearchProviders 로 주입한다.
// cursor 는 앱마다 다른 모양(숫자 offset·문자열·메일의 (receivedAt, id))이라 unknown 으로 두고 각 provider 가 해석한다. next === null 이면 끝.
import type { QueryClient } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'

import { calendarApi } from '@/api/calendar'
import { contactsApi } from '@/api/contacts'
import { fetchMeIssues } from '@/api/meIssues'
import { messagingApi } from '@/api/messaging'
import { searchAiConversations } from '@/api/searchAiConversations'
import { searchDriveByName } from '@/api/searchDrive'
import { type MailSearchCursor, type MailSearchItem, searchMail } from '@/api/searchMail'
import { wikiApi } from '@/api/wiki'
import { driveFilePath } from '@/components/viewer/driveOpen'
import { messagingKeys } from '@/hooks/queries/messagingKeys'
import { allProjectsQuery } from '@/hooks/queries/useProjects'
import { CHAT_PARAM, LINKED_SESSION_FALLBACK_TITLE } from '@/lib/aiChatLink'
import { chatConversationPath, driveFolderPath, issuePath, mailMessagePath, projectPath, wikiSpacePagePath } from '@/lib/appUrl'
import { encodeContactParam } from '@/lib/contactParam'
import { dmDisplayName } from '@/lib/dm'
import { formatListTime } from '@/lib/formatters'
import { formatIssueKey } from '@/lib/issueKey'

import { toCalendarHit } from './calendarHit'
import type { SearchAppId } from './searchApps'
import { isSearchableTerm, stripHtmlTags } from './searchRules'

/** 결과 한 줄 — key 는 탭 사이에서 유일(앱 접두사 포함). */
export interface SearchHit {
  key: string
  app: SearchAppId
  title: string
  href: string
  meta?: string
  /** 둘째 줄 보조 글 — 반드시 HTML 이 없는 평문(provider 가 출처에서 태그를 벗긴다). 화면은 그대로 텍스트 노드로 그린다. */
  snippet?: string
  /** 있으면 snippet 앞에 「라벨: 」을 붙이고 snippet 의 맞은 곳도 강조한다(캘린더의 「장소: …」·「참석자: …」). */
  snippetLabel?: string
  /** 「전체」 탭 묶음처럼 좁은 자리에서 쓰는 짧은 meta — 없으면 meta. */
  metaShort?: string
  /** meta 뒤에 점(팔레트 색)과 이름으로 붙는 꼬리표(캘린더 이름). 「전체」 탭 묶음에서는 숨긴다. */
  tag?: { name: string; color: string | null }
  /** 종류 탭에서 이 값이 바뀌는 자리에 소제목을 그린다(캘린더의 다가오는/지난 일정). */
  group?: string
  /** 흐리게 보인다(지난 일정). */
  dimmed?: boolean
  /** 앱 아이콘 대신 쓰는 아이콘(반복 일정). */
  icon?: LucideIcon
  /** 첫 줄 오른쪽 끝에 붙는 날짜 같은 짧은 평문(예: AI 대화의 마지막 대화 시각). */
  time?: string
}

/** 한 쪽 결과 — next 가 null 이면 더 없다. */
export interface SearchPage {
  hits: SearchHit[]
  next: unknown | null
}

/** provider 가 의존하는 것 — 훅 밖에서 읽을 수 없는 값을 팔레트가 만들어 넣는다(테스트는 테스트용 QueryClient·id 를 넣는다). */
export interface SearchProviderDeps {
  /** 프로젝트·채널·DM·메일 계정처럼 검색어와 무관한 목록을 TanStack 캐시로 재사용한다. */
  queryClient: QueryClient
  /** 현재 사용자 id — DM 표시명 파생용. 로그인 전이면 null. */
  meId: number | null
}

export interface SearchProvider {
  /** 이 앱에 보낼 만한 검색어인가 — 기본은 공백 뺀 두 글자부터(한 글자는 거의 전부 맞아 느리고 쓸모없다). */
  isSearchable(term: string): boolean
  fetchPage(q: string, cursor: unknown | null, size: number, signal?: AbortSignal): Promise<SearchPage>
}

/** 같은 key 의 hit 은 처음 것만 남긴다 — offset 쪽 나누기는 목록이 바뀌는 사이 같은 항목이 두 쪽에 걸쳐 올 수 있다(WP-1353). */
export function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>()
  return hits.filter((h) => !seen.has(h.key) && seen.add(h.key))
}

/** 검색어와 무관한 목록 캐시 유지 시간 — 검색어를 바꿔 칠 때마다 다시 받지 않게. */
const LIST_STALE_MS = 10_000

/** 캐시를 거쳐(fetchQuery) 조회한다 — 검색어를 바꿔 칠 때마다 같은 목록을 다시 받지 않게. */
function cached<T>(qc: QueryClient, queryKey: readonly unknown[], queryFn: () => Promise<T>): Promise<T> {
  return qc.fetchQuery({ queryKey, queryFn, staleTime: LIST_STALE_MS })
}

/** 기본 검색 가능 판정 — 공백 뺀 두 글자부터. */
const defaultSearchable = (term: string) => term.trim().length >= 2

/** cursor 가 숫자 offset 이면 그것, 아니면 0(첫 쪽). */
function asOffset(cursor: unknown | null): number {
  return typeof cursor === 'number' ? cursor : 0
}

const includesIgnoreCase = (text: string, q: string) => text.toLowerCase().includes(q.toLowerCase())

// ── 대화(채널·DM) ──────────────────────────────────────────────

/** 대화 cursor — 첫 쪽에서 받아 만든 전체 목록 중 아직 안 보여 준 나머지. 다음 쪽은 이것만 자르고 요청하지 않는다. */
interface ChatCursor {
  rest: SearchHit[]
}

/** cursor 가 ChatCursor 인가(첫 쪽은 null). */
function isChatCursor(cursor: unknown): cursor is ChatCursor {
  return typeof cursor === 'object' && cursor !== null && 'rest' in cursor
}

/** 전체 목록에서 size 건만 한 쪽으로 자르고 나머지는 cursor 에 싣는다. */
function pageOf(all: SearchHit[], size: number): SearchPage {
  return {
    hits: all.slice(0, size),
    next: all.length > size ? ({ rest: all.slice(size) } satisfies ChatCursor) : null,
  }
}

/** 채널 한 건의 hit — meta 는 「참여 중」/「공개」. */
function channelHit(c: { id: number; name: string }, meta: string): SearchHit {
  return {
    key: `chat:channel:${c.id}`,
    app: 'chat',
    title: `# ${c.name}`,
    href: chatConversationPath(c.id, false),
    meta,
  }
}

/**
 * 내 채널·DM 이름(화면에서 거름 — 서버에 이름 검색이 없다)을 먼저, 그다음 가입 안 한 공개 채널(discover)을 보인다.
 * 서버가 쪽 나누기를 안 하므로 첫 쪽에서 한 번만 받아 전체 순서를 만들고, 나머지를 cursor 에 실어 다음 쪽은 요청 없이 자른다.
 * DM 이름 파생에 필요한 현재 사용자 id 는 deps.meId 로 받는다.
 */
function createChatProvider({ queryClient: qc, meId }: SearchProviderDeps): SearchProvider {
  return {
    isSearchable: defaultSearchable,
    async fetchPage(q, cursor, size, signal) {
      if (isChatCursor(cursor)) return pageOf(cursor.rest, size)
      const [channels, dms, discovered] = await Promise.all([
        cached(qc, messagingKeys.channels(), () => messagingApi.listChannels().then((r) => r.data)),
        cached(qc, messagingKeys.dms(), () => messagingApi.listDms().then((r) => r.data)),
        messagingApi.discoverChannels(q, signal).then((r) => r.data),
      ])
      const mine = channels.filter((c) => c.member && !c.archived && includesIgnoreCase(c.name, q))
      const myIds = new Set(channels.filter((c) => c.member).map((c) => c.id))
      const all: SearchHit[] = [
        ...mine.map((c) => channelHit(c, '참여 중')),
        ...dms
          // 로그인 전(meId 없음)에는 어떤 참여자와도 안 겹치는 -1 — 팔레트는 로그인 뒤에만 뜨므로 실제로는 오지 않는다.
          .map((d) => ({ d, name: dmDisplayName(d, meId ?? -1) }))
          .filter(({ name }) => includesIgnoreCase(name, q))
          .map<SearchHit>(({ d, name }) => ({
            key: `chat:dm:${d.id}`,
            app: 'chat',
            title: name,
            href: chatConversationPath(d.id, true),
            meta: '참여 중',
          })),
        // 내 채널 id 는 제외 — discover 가 같은 채널을 또 줘도 한 번만.
        ...discovered.filter((c) => !myIds.has(c.id)).map((c) => channelHit(c, '공개')),
      ]
      return pageOf(all, size)
    },
  }
}

// ── 메일 ─────────────────────────────────────────────────────

/** 오른쪽 meta 의 사람 — 보낸편지함은 「받는 사람 ○○( 외 N명)」, 그 밖은 보낸 사람. */
function mailPerson(m: MailSearchItem): string | undefined {
  if (m.folderKind === 'SENT') {
    if (!m.firstRecipient) return undefined
    const more = m.recipientCount - 1
    return more > 0 ? `받는 사람 ${m.firstRecipient} 외 ${more}명` : `받는 사람 ${m.firstRecipient}`
  }
  return m.fromName || m.fromAddress || undefined
}

/** 고르면 그 메일이 든 메일함을 연 채로 연다. */
function mailHref(m: MailSearchItem): string {
  if (m.folderKind === 'SENT') return mailMessagePath(m.accountId, m.id, { kind: 'sent' })
  if (m.folderKind === 'OTHER' && m.folderId != null) return mailMessagePath(m.accountId, m.id, { kind: 'box', folderId: m.folderId })
  return mailMessagePath(m.accountId, m.id)
}

/** cursor 가 메일 커서인가(첫 쪽은 null). */
function isMailCursor(cursor: unknown): cursor is MailSearchCursor {
  return typeof cursor === 'object' && cursor !== null && 'beforeId' in cursor
}

/**
 * 내 모든 메일 계정의 휴지통·스팸·임시보관함을 뺀 모든 메일함을 한 API 로 찾는다(WP-1359) — 계정·메일함을 서버가 최신순으로 합친다.
 * 다음 쪽 커서는 이번 쪽 마지막 항목의 (receivedAt, id) — receivedAt 은 서버 문자열 그대로 넘긴다.
 */
const mailProvider: SearchProvider = {
  isSearchable: defaultSearchable,
  async fetchPage(q, cursor, size, signal) {
    const res = await searchMail(q, isMailCursor(cursor) ? cursor : null, size, signal)
    const hits = res.items.map<SearchHit>((m) => ({
      key: `mail:${m.id}`,
      app: 'mail',
      title: m.subject?.trim() || '(제목 없음)',
      href: mailHref(m),
      meta: [m.folderName, mailPerson(m)].filter(Boolean).join(' · '),
      snippet: m.snippet ?? undefined,
      time: m.receivedAt ? formatListTime(m.receivedAt) : undefined,
    }))
    const last = res.items[res.items.length - 1]
    const next: MailSearchCursor | null = res.hasMore && last ? { beforeAt: last.receivedAt, beforeId: last.id } : null
    return { hits, next }
  },
}

// ── 작업(프로젝트·이슈) ─────────────────────────────────────────

/** 첫 쪽에 앞세우는 프로젝트 최대 건수 — 쪽 크기의 절반을 넘지 않게 해 이슈가 밀려나지 않게 한다(전체 탭 묶음은 4건뿐). */
const MAX_PROJECT_HITS = 5

/** 내 프로젝트 전부 — 캐시가 있으면 useAllProjects 와 같은 쿼리를 재사용한다. */
function loadProjects(qc: QueryClient) {
  return qc.fetchQuery({ ...allProjectsQuery(), staleTime: LIST_STALE_MS })
}

/** 작업 검색 — 한 글자 작업 번호(`7`·`#7`)도 보내므로 판정이 다르다(isSearchableTerm). */
function createIssuesProvider({ queryClient: qc }: SearchProviderDeps): SearchProvider {
  return {
    isSearchable: (term) => isSearchableTerm(term.trim()),
    async fetchPage(q, cursor, size, signal) {
      const first = cursor == null
      const maxProjects = Math.min(MAX_PROJECT_HITS, Math.floor(size / 2))
      const [projects, issues] = await Promise.all([
        // 프로젝트는 첫 쪽에만 — useAllProjects 와 같은 쿼리(캐시 공유)로 전부 받아 이름·키 부분 일치로 화면에서 거른다.
        first
          ? loadProjects(qc).then((p) =>
              p.content.filter((c) => includesIgnoreCase(c.name, q) || includesIgnoreCase(c.key, q)).slice(0, maxProjects),
            )
          : Promise.resolve([]),
        fetchMeIssues({ q }, typeof cursor === 'string' ? cursor : null, size, signal),
      ])
      const hits: SearchHit[] = [
        ...projects.map<SearchHit>((p) => ({
          key: `issues:project:${p.key}`,
          app: 'issues',
          title: p.name,
          href: projectPath(p.key),
          meta: '프로젝트',
          snippet: p.key,
        })),
        ...issues.items.map<SearchHit>((i) => ({
          key: `issues:issue:${i.id}`,
          app: 'issues',
          title: `${formatIssueKey(i.projectKey, i.number)} ${i.title}`,
          href: issuePath(i.projectKey, i.number),
          meta: i.statusName,
        })),
      ]
      return { hits, next: issues.hasMore ? issues.nextCursor : null }
    },
  }
}

// ── 드라이브 ─────────────────────────────────────────────────

const driveProvider: SearchProvider = {
  isSearchable: defaultSearchable,
  async fetchPage(q, cursor, size, signal) {
    const offset = asOffset(cursor)
    const res = await searchDriveByName(q, offset, size, signal)
    const hits = res.items.map<SearchHit>((i) => ({
      key: `drive:${i.kind}:${i.id}`,
      app: 'drive',
      title: i.name,
      // 파일은 담긴 폴더에서 미리보기로, 폴더는 그 폴더 자체를 연다.
      href: i.kind === 'FILE' ? driveFilePath(i.spaceId, i.folderId, i.id) : driveFolderPath(i.spaceId, i.id),
      meta: i.folderPath ? `${i.spaceName} › ${i.folderPath}` : i.spaceName,
    }))
    return { hits, next: res.hasMore ? offset + size : null }
  },
}

// ── AI 대화 ──────────────────────────────────────────────────

/** 내 지난 AI 대화(키워드 검색, offset 쪽 나누기). 고르면 지금 화면에서 AI 패널로 연다(`/?aiChat=<id>` 딥링크). */
const aiProvider: SearchProvider = {
  isSearchable: defaultSearchable,
  async fetchPage(q, cursor, size, signal) {
    const offset = asOffset(cursor)
    const res = await searchAiConversations(q, offset, size, signal)
    const hits = res.items.map<SearchHit>((i) => ({
      key: `ai:${i.sessionId}`,
      app: 'ai',
      title: i.title?.trim() || LINKED_SESSION_FALLBACK_TITLE,
      href: `/?${CHAT_PARAM}=${i.sessionId}`,
      // 맞은 메시지가 질문인지 답인지를 앞에 붙여 보인다.
      snippet: `${i.role === 'USER' ? '질문' : '답'} · ${i.excerpt}`,
      time: formatListTime(i.lastMessageAt),
    }))
    return { hits, next: res.hasMore ? offset + size : null }
  },
}

// ── 노트 ─────────────────────────────────────────────────────

const wikiProvider: SearchProvider = {
  isSearchable: defaultSearchable,
  async fetchPage(q, cursor, size, signal) {
    const offset = asOffset(cursor)
    const { data } = await wikiApi.search(q, undefined, {
      size,
      offset,
      signal,
    })
    const hits = data.map<SearchHit>((r) => ({
      key: `wiki:${r.id}`,
      app: 'wiki',
      title: r.title,
      href: wikiSpacePagePath(r.spaceId, r.id),
      meta: r.spaceName,
      // 서버 snippet 은 `<b>일치</b>` 같은 HTML 이 섞여 온다 — 출처에서 벗겨 SearchHit.snippet 을 평문으로 지킨다.
      snippet: stripHtmlTags(r.snippet),
    }))
    // 서버가 더 있는지 알려 주지 않는다 — 꽉 찬 쪽이면 다음이 있을 수 있다고 본다.
    return { hits, next: data.length === size ? offset + size : null }
  },
}

// ── 연락처 ───────────────────────────────────────────────────

const contactsProvider: SearchProvider = {
  isSearchable: defaultSearchable,
  async fetchPage(q, cursor, size, signal) {
    const { data } = await contactsApi.list(
      {
        search: q,
        ...(typeof cursor === 'string' ? { cursor } : {}),
        limit: size,
      },
      signal,
    )
    const hits = data.items.map<SearchHit>((c) => ({
      key: `contacts:${c.type}:${c.id}`,
      app: 'contacts',
      title: c.name,
      href: `/contacts?contact=${encodeContactParam({ type: c.type, id: c.id })}`,
      meta: c.organization ?? undefined,
      snippet: c.email ?? undefined,
    }))
    return { hits, next: data.hasMore ? data.nextCursor : null }
  },
}

// ── 캘린더 ───────────────────────────────────────────────────

/** 일정 검색 — 서버가 정렬(다가오는 순 → 지난 순)·시리즈 접기·쪽 나누기를 하고, cursor 는 서버의 nextCursor 문자열 그대로다. */
const calendarProvider: SearchProvider = {
  isSearchable: defaultSearchable,
  async fetchPage(q, cursor, size, signal) {
    const { data } = await calendarApi.search(q, typeof cursor === 'string' ? cursor : null, size, signal)
    const now = new Date()
    return { hits: data.items.map((i) => toCalendarHit(i, now)), next: data.nextCursor }
  },
}

/** 앱 → provider 를 deps 로 만든다. */
export function createSearchProviders(deps: SearchProviderDeps): Record<SearchAppId, SearchProvider> {
  return {
    ai: aiProvider,
    chat: createChatProvider(deps),
    mail: mailProvider,
    calendar: calendarProvider,
    issues: createIssuesProvider(deps),
    drive: driveProvider,
    wiki: wikiProvider,
    contacts: contactsProvider,
  }
}
