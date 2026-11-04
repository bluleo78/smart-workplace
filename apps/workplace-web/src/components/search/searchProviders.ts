// 통합 검색(WP-1353)의 앱별 provider — 앱마다 기존 API 로 한 쪽씩 찾아 공통 모양(SearchHit)으로 돌려준다.
// 훅이 아닌 평범한 async 함수라 팔레트(useQuery·useInfiniteQuery)와 테스트(MSW)가 같이 쓴다.
// cursor 는 앱마다 다른 모양(숫자 offset·문자열·계정별 묶음)이라 unknown 으로 두고 각 provider 가 해석한다. next === null 이면 끝.
import { authApi } from '@/api/auth'
import { contactsApi } from '@/api/contacts'
import { listMailAccounts } from '@/api/mailAccounts'
import { listMessages } from '@/api/mailMessages'
import { fetchMeIssues } from '@/api/meIssues'
import { messagingApi } from '@/api/messaging'
import { projectsApi } from '@/api/projects'
import { searchDriveByName } from '@/api/searchDrive'
import { wikiApi } from '@/api/wiki'
import { driveFilePath } from '@/components/viewer/driveOpen'
import { fetchAllProjects } from '@/hooks/queries/useProjects'
import { driveFolderPath, issuePath, mailMessagePath } from '@/lib/appUrl'
import { encodeContactParam } from '@/lib/contactParam'
import { dmDisplayName } from '@/lib/dm'
import { formatIssueKey } from '@/lib/issueKey'
import type { MailListCursor } from '@/types/mailMessage'

import type { SearchAppId } from './searchApps'

/** 결과 한 줄 — key 는 탭 사이에서 유일(앱 접두사 포함). */
export interface SearchHit {
  key: string
  app: SearchAppId
  title: string
  href: string
  meta?: string
  snippet?: string
}

/** 한 쪽 결과 — next 가 null 이면 더 없다. */
export interface SearchPage {
  hits: SearchHit[]
  next: unknown | null
}

export interface SearchProvider {
  app: SearchAppId
  fetchPage(q: string, cursor: unknown | null, size: number, signal?: AbortSignal): Promise<SearchPage>
}

const EMPTY: SearchPage = { hits: [], next: null }

/** 아직 검색을 지원하지 않는 앱(AI 대화·캘린더) — 늘 빈 결과. */
function emptyProvider(app: SearchAppId): SearchProvider {
  return { app, fetchPage: async () => EMPTY }
}

/** cursor 가 숫자 offset 이면 그것, 아니면 0(첫 쪽). */
function asOffset(cursor: unknown | null): number {
  return typeof cursor === 'number' ? cursor : 0
}

const includesIgnoreCase = (text: string, q: string) => text.toLowerCase().includes(q.toLowerCase())

// ── 대화(채널·DM) ──────────────────────────────────────────────

/**
 * 내 채널·DM 이름(화면에서 거름 — 서버에 이름 검색이 없다)을 먼저, 그다음 가입 안 한 공개 채널(discover)을 보인다.
 * 서버가 쪽 나누기를 안 하므로 합친 목록을 cursor(숫자 offset)로 화면에서 size 건씩 자른다.
 */
const chatProvider: SearchProvider = {
  app: 'chat',
  async fetchPage(q, cursor, size) {
    const offset = asOffset(cursor)
    const [channels, dms, me, discovered] = await Promise.all([
      messagingApi.listChannels().then((r) => r.data),
      messagingApi.listDms().then((r) => r.data),
      authApi.me().then((r) => r.data),
      messagingApi.discoverChannels(q).then((r) => r.data),
    ])
    const mine = channels.filter((c) => c.member && !c.archived && includesIgnoreCase(c.name, q))
    const myIds = new Set(channels.filter((c) => c.member).map((c) => c.id))
    const all: SearchHit[] = [
      ...mine.map<SearchHit>((c) => ({
        key: `chat:channel:${c.id}`,
        app: 'chat',
        title: `# ${c.name}`,
        href: `/chat/channels/${c.id}`,
        meta: '참여 중',
      })),
      ...dms
        .map((d) => ({ d, name: dmDisplayName(d, me.id) }))
        .filter(({ name }) => includesIgnoreCase(name, q))
        .map<SearchHit>(({ d, name }) => ({
          key: `chat:dm:${d.id}`,
          app: 'chat',
          title: name,
          href: `/chat/dms/${d.id}`,
          meta: '참여 중',
        })),
      // 내 채널 id 는 제외 — discover 가 같은 채널을 또 줘도 한 번만.
      ...discovered
        .filter((c) => !myIds.has(c.id))
        .map<SearchHit>((c) => ({
          key: `chat:channel:${c.id}`,
          app: 'chat',
          title: `# ${c.name}`,
          href: `/chat/channels/${c.id}`,
          meta: '공개',
        })),
    ]
    const hits = all.slice(offset, offset + size)
    return { hits, next: offset + size < all.length ? offset + size : null }
  },
}

// ── 메일 ─────────────────────────────────────────────────────

/** 계정별 이어 받기 상태 — 'done' 은 그 계정을 다 읽음, 커서 없음(null)은 처음부터. */
type MailAccountCursor = MailListCursor | 'done' | null
type MailCursor = Record<number, MailAccountCursor>

/** 최신순 비교 — receivedAt 이 같으면 id 큰 쪽이 먼저(서버 정렬 키와 같다). 시각이 없는 행은 맨 뒤. */
function newerFirst(a: { receivedAt: string | null; id: number }, b: { receivedAt: string | null; id: number }): number {
  if (a.receivedAt !== b.receivedAt) {
    if (a.receivedAt == null) return 1
    if (b.receivedAt == null) return -1
    const diff = Date.parse(b.receivedAt) - Date.parse(a.receivedAt)
    if (diff !== 0 && !Number.isNaN(diff)) return diff
    // 같은 밀리초 안(마이크로초 차이)은 문자열로 가른다.
    return a.receivedAt < b.receivedAt ? 1 : -1
  }
  return b.id - a.id
}

/**
 * 계정마다 받은편지함을 검색해 최신순으로 합친다. 계정별 다음 커서는 그 계정에서 이번 쪽에 「실제로 보여 준」 마지막 항목 —
 * 가져왔지만 안 보여 준 것은 다음 쪽에 다시 나와야 빠지지 않는다. 하나도 못 낸 계정은 이전 커서를 유지하고,
 * 받은 건수가 size 미만이며 전부 보여 준 계정만 끝('done')으로 본다.
 */
const mailProvider: SearchProvider = {
  app: 'mail',
  async fetchPage(q, cursor, size) {
    const accounts = await listMailAccounts()
    if (accounts.length === 0) return EMPTY
    const prev: MailCursor = cursor && typeof cursor === 'object' ? (cursor as MailCursor) : {}
    const active = accounts.filter((a) => prev[a.id] !== 'done')
    const fetched = await Promise.all(
      active.map(async (a) => {
        const before = prev[a.id] as MailListCursor | null | undefined
        const rows = await listMessages(a.id, 'INBOX', q, undefined, undefined, undefined, size, null, before ?? null)
        return { accountId: a.id, rows }
      }),
    )
    const merged = fetched
      .flatMap(({ rows }) => rows)
      .sort(newerFirst)
      .slice(0, size)

    const next: MailCursor = { ...prev }
    for (const { accountId, rows } of fetched) {
      const shown = merged.filter((m) => m.accountId === accountId)
      if (shown.length === 0 && rows.length > 0) continue // 하나도 못 냈다 — 이전 커서 유지
      if (rows.length < size && shown.length === rows.length) {
        next[accountId] = 'done'
      } else {
        const last = shown[shown.length - 1]
        next[accountId] = { receivedAt: last.receivedAt, id: last.id }
      }
    }
    const finished = accounts.every((a) => next[a.id] === 'done')
    const hits = merged.map<SearchHit>((m) => ({
      key: `mail:${m.id}`,
      app: 'mail',
      title: m.subject?.trim() || '(제목 없음)',
      href: mailMessagePath(m.accountId, m.id),
      meta: m.fromName || m.fromAddress || undefined,
      snippet: m.snippet ?? undefined,
    }))
    return { hits, next: finished ? null : next }
  },
}

// ── 작업(프로젝트·이슈) ─────────────────────────────────────────

/** 첫 쪽에 앞세우는 프로젝트 최대 건수. */
const MAX_PROJECT_HITS = 5

const issuesProvider: SearchProvider = {
  app: 'issues',
  async fetchPage(q, cursor, size, signal) {
    const first = cursor == null
    const [projects, issues] = await Promise.all([
      // 프로젝트는 첫 쪽에만 — useAllProjects 와 같은 조회(전부 받기)를 하고 이름·키 부분 일치로 화면에서 거른다.
      first
        ? fetchAllProjects((page, s) => projectsApi.list({ page, size: s }).then((r) => r.data)).then((p) =>
            p.content.filter((c) => includesIgnoreCase(c.name, q) || includesIgnoreCase(c.key, q)).slice(0, MAX_PROJECT_HITS),
          )
        : Promise.resolve([]),
      fetchMeIssues({ q }, typeof cursor === 'string' ? cursor : null, size, signal),
    ])
    const hits: SearchHit[] = [
      ...projects.map<SearchHit>((p) => ({
        key: `issues:project:${p.key}`,
        app: 'issues',
        title: p.name,
        href: `/projects/${p.key}`,
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

// ── 드라이브 ─────────────────────────────────────────────────

const driveProvider: SearchProvider = {
  app: 'drive',
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

// ── 노트 ─────────────────────────────────────────────────────

const wikiProvider: SearchProvider = {
  app: 'wiki',
  async fetchPage(q, cursor, size, signal) {
    const offset = asOffset(cursor)
    const { data } = await wikiApi.search(q, undefined, { size, offset, signal })
    const hits = data.map<SearchHit>((r) => ({
      key: `wiki:${r.id}`,
      app: 'wiki',
      title: r.title,
      // /wiki/open 우회는 히스토리를 하나 더 남기므로 노트 경로를 바로 만든다.
      href: `/wiki/spaces/${r.spaceId}/pages/${r.id}`,
      meta: r.spaceName,
      snippet: r.snippet,
    }))
    // 서버가 더 있는지 알려 주지 않는다 — 꽉 찬 쪽이면 다음이 있을 수 있다고 본다.
    return { hits, next: data.length === size ? offset + size : null }
  },
}

// ── 연락처 ───────────────────────────────────────────────────

const contactsProvider: SearchProvider = {
  app: 'contacts',
  async fetchPage(q, cursor, size) {
    const { data } = await contactsApi.list({ search: q, ...(typeof cursor === 'string' ? { cursor } : {}), limit: size })
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

/** 앱 → provider. ai·calendar 는 아직 검색이 없어 빈 결과를 낸다. */
export const SEARCH_PROVIDERS: Record<SearchAppId, SearchProvider> = {
  ai: emptyProvider('ai'),
  chat: chatProvider,
  mail: mailProvider,
  calendar: emptyProvider('calendar'),
  issues: issuesProvider,
  drive: driveProvider,
  wiki: wikiProvider,
  contacts: contactsProvider,
}
