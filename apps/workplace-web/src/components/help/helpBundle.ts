// 도움말 묶음(WP-1504 산출물, 정적 파일 `/help/…`)의 타입과 불러오기(WP-1505).
// 형식의 원본은 설계 문서 docs/superpowers/specs/help-panel-design.md 14절과 생성기 docs/manual/scripts/lib/help-bundle.mjs 다.
// 웹은 읽기만 한다 — 필드 이름을 바꾸거나 빼지 않는다(계약 변경). 생성기가 더한 필드(장 number, 절 level, 표식 key)도 그대로 받는다.
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { shouldRetryQuery } from '@/lib/queryRetry'

/** 묶음이 놓이는 정적 경로의 앞부분 — `figures[].src` 같은 묶음 루트 기준 상대 경로 앞에 붙인다. */
export const HELP_BASE = '/help'

/** 목차(manual-index.json)의 절 한 칸 — 본문 없이 이름·층만. */
export interface HelpIndexSection {
  /** 도움말 id. 제목 표시에 id 가 없는 절은 `<chapter>#<slug>`(예: `agents#_intro`). */
  id: string
  /** 화면 칸 이름(브레드크럼·목록 표시용). 늘 문자열이다 — 생성기가 제목 표시의 label, 없으면 제목으로 채우고 검사가 빈 값을 막는다. */
  label: string
  title: string
  /** 감싸는 위 층 가운데 가장 가까운, 도움말 id 가 있는 절(없으면 null). */
  parent: string | null
  /** 제목 깊이(첫머리 절 1, `##` 2 …). id 없는 절도 층이 있어 조상 찾기는 이것으로 한다. */
  level: number
}

/** 목차의 장 하나. */
export interface HelpIndexChapter {
  chapter: string
  number: number
  title: string
  /** 이 장이 설명하는 화면 주소(react-router 경로 꼴). 비면 어느 주소와도 맞지 않는다. */
  routes: string[]
  /** 읽는 사람(`member`·`admin`). `admin` 만 있으면 관리자 장이다. */
  audience: string[]
  sections: HelpIndexSection[]
}

/** 절 본문에 든 그림 하나 — 본문에는 `![alt](figure:<id>)` 로 들어 있다. */
export interface HelpFigure {
  id: string
  /** 묶음 루트 기준 상대 경로(`figures/<id>.png`) — 앞에 HELP_BASE 를 붙여 쓴다. */
  src: string
  alt: string
  /** 그림 위 번호 표식과 그 짧은 설명. */
  marks: { n: number; label: string; key?: string }[]
}

/** 장 파일(manual/<chapter>.json)의 절 — 목차 칸에 본문·그림·관련 링크가 더해진다. */
export interface HelpSection extends HelpIndexSection {
  /** 절 본문(하위 절 제외). 자리표시·조건 블록은 글자 그대로 들어 있다(화면이 채운다). */
  markdown: string
  figures: HelpFigure[]
  /** 본문이 가리키는 다른 절 id — 「관련」 목록의 원천. */
  links: string[]
}

/** 장 파일 하나. */
export type HelpChapter = Omit<HelpIndexChapter, 'sections'> & { sections: HelpSection[] }

/** manual-vars.json — 화면이 채울 수 있는 자리표시·조건의 목록과 값이 없을 때의 표시. */
export interface HelpVars {
  placeholders: { name: string; display: string; description: string }[]
  conditions: { name: string; tag: string; description: string }[]
}

/** 묶음 파일 응답이 실패 상태 — 재시도 판단(helpRetry)이 상태를 보도록 든다. */
export class HelpHttpError extends Error {
  readonly status: number
  constructor(status: number, path: string, message = `도움말 묶음을 받지 못했습니다(${status}): ${path}`) {
    super(message)
    this.name = 'HelpHttpError'
    this.status = status
  }
}

/** 묶음 파일이 없음(404) — 「다시 시도」로 나아지지 않으므로 재시도하지 않고, 장 파일이면 목차로 내려가는 판단에 쓴다. */
export class HelpNotFoundError extends HelpHttpError {
  constructor(path: string) {
    super(404, path, `도움말 묶음 파일이 없습니다: ${path}`)
    this.name = 'HelpNotFoundError'
  }
}

/**
 * 묶음 파일 하나를 받아 JSON 으로 돌려준다.
 * - 404 는 본문을 읽지 않고 HelpNotFoundError — nginx 는 html, vite 는 빈 본문을 주므로 본문으로는 판단할 수 없다.
 * - 그 밖의 실패 상태는 상태를 든 HelpHttpError, JSON 이 아닌 200(프록시가 끼운 html 등)은 일반 Error — 「다시 시도」 단추 대상이다.
 * - 네트워크 실패(fetch 의 TypeError)·중단은 그대로 던진다.
 * @param path HELP_BASE 뒤 경로(예: `manual-index.json`)
 */
export async function fetchHelpJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${HELP_BASE}/${path}`, { signal })
  if (res.status === 404) throw new HelpNotFoundError(path)
  if (!res.ok) throw new HelpHttpError(res.status, path)
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`도움말 묶음 형식 오류: ${path}`)
  }
}

/**
 * 자동 재시도 여부 — 앱 전역 정책(shouldRetryQuery)과 같다: 4xx(없음 404 포함)는 다시 받아도 같으므로 바로 실패,
 * 5xx·네트워크 오류·형식 오류만 한 번 더. shouldRetryQuery 는 axios 오류의 상태만 보므로 fetch 의 상태(HelpHttpError)를 여기서 먼저 본다.
 */
export function helpRetry(failureCount: number, error: Error): boolean {
  if (error instanceof HelpHttpError && error.status < 500) return false
  return shouldRetryQuery(failureCount, error)
}

/** 세 질의 공통 옵션 — 묶음은 배포마다 바뀌는 정적 파일이라 한 번 받으면 세션 동안 다시 받지 않는다. 재시도는 helpRetry. */
const HELP_QUERY_OPTIONS = { staleTime: Infinity, retry: helpRetry } as const

/** 목차(manual-index.json). */
export function useHelpIndex(): UseQueryResult<HelpIndexChapter[]> {
  return useQuery({
    queryKey: ['help', 'index'],
    queryFn: ({ signal }) => fetchHelpJson<HelpIndexChapter[]>('manual-index.json', signal),
    ...HELP_QUERY_OPTIONS,
  })
}

/** 자리표시·조건 목록(manual-vars.json). 못 받아도 본문은 보인다(이름 그대로 표시). */
export function useHelpVars(): UseQueryResult<HelpVars> {
  return useQuery({
    queryKey: ['help', 'vars'],
    queryFn: ({ signal }) => fetchHelpJson<HelpVars>('manual-vars.json', signal),
    ...HELP_QUERY_OPTIONS,
  })
}

/** 장 파일 하나(manual/<chapter>.json). chapter 가 null 이면(목차를 보일 때) 받지 않는다. */
export function useHelpChapter(chapter: string | null): UseQueryResult<HelpChapter> {
  return useQuery({
    queryKey: ['help', 'chapter', chapter],
    queryFn: ({ signal }) => fetchHelpJson<HelpChapter>(`manual/${encodeURIComponent(chapter ?? '')}.json`, signal),
    enabled: chapter !== null,
    ...HELP_QUERY_OPTIONS,
  })
}
