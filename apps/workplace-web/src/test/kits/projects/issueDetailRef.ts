// 이슈 상세 화면 페이지 테스트 공용 도구(WP-980 b4) — 코멘트·반응·동시 편집·본문 이미지 페이지 테스트가 같이 쓴다.
// 상세 화면이 부르는 조회(프로젝트·멤버·상세·하위 섹션)를 MSW 로 깔고, 상세는 ref 로 들고 있어 쓰기 핸들러가 서버처럼 고칠 수 있다.
import { act } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { http, HttpResponse } from 'msw'

import type { IssueDetailResponse } from '@/types/issue'
import type { MemberResponse } from '@/types/project'

import { createIssueDetail } from '../../../../e2e/factories/issue.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

export const KEY = 'WP'
export const ISSUE_NUMBER = 1
/** createIssue() 기본 id — 코멘트·반응 API 경로(/issues/{issueId}/...)에 쓰인다. */
export const ISSUE_ID = 100
/** createUser() 기본 id — renderPage 의 로그인 사용자. */
export const ME_ID = 1
export const DETAIL_PATH = `/projects/${KEY}/issues/${ISSUE_NUMBER}`
export const DETAIL_API = `/api/v1/projects/${KEY}/issues/${ISSUE_NUMBER}`

export type DetailRef = { current: IssueDetailResponse }

/** 상세 화면 조회 API — detailRef.current 를 그대로 돌려준다(쓰기 핸들러가 바꾸면 재조회에 반영). */
export function detailHandlers(detailRef: DetailRef, members: MemberResponse[] = []) {
  return [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
    http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json(members)),
    http.get(DETAIL_API, () => HttpResponse.json(detailRef.current)),
    ...['watchers', 'labels', 'attachments', 'children'].map((sub) =>
      http.get(`${DETAIL_API}/${sub}`, () => HttpResponse.json([])),
    ),
    // 하위 태스크 섹션의 자식 검색.
    http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
  ]
}

/** 새 상세 ref — 기본은 코멘트 없는 상세. */
export function detailRefOf(overrides: Partial<IssueDetailResponse> = {}): DetailRef {
  return { current: createIssueDetail(overrides) }
}

/**
 * RichInput(TipTap) 내용을 통째로 바꾼다 — jsdom 은 contenteditable 키 입력을 브라우저처럼 처리하지 못해
 * 편집기 명령으로 값을 채운다(일반 입력의 fireEvent.change 와 같은 역할). 키 입력 자체는 E2E(@input)가 본다.
 */
export function setRichText(el: HTMLElement, text: string) {
  const editor = (el.closest('.ProseMirror') ?? el.querySelector('.ProseMirror') ?? el) as HTMLElement & { editor?: Editor }
  if (!editor.editor) throw new Error('TipTap 편집기를 찾지 못했다')
  act(() => {
    editor.editor!.commands.setContent(text ? `<p>${text}</p>` : '', true)
  })
}
