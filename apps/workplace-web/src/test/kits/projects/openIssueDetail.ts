// 이슈 상세를 App 전체(renderPage)로 여는 도우미 — 핸들러(issueDetailStubs)와 나눠 두었다(WP-1002).
// 핸들러만 쓰는 화면 테스트(renderScreen)가 이 파일을 거치지 않아 App·전역 UI 모듈을 불러오지 않는다.
import { screen } from '@testing-library/react'
import type { RequestHandler } from 'msw'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { detailNumberOf, issueDetailHandlers, type IssueDetailOptions } from './issueDetailStubs'

/** 이슈 상세를 열고 제목이 뜰 때까지 기다린다. extra 핸들러는 기본보다 우선한다. */
export async function openIssueDetail(options: IssueDetailOptions & { handlers?: RequestHandler[]; path?: string } = {}) {
  const { handlers = [], path, ...rest } = options
  const key = rest.key ?? 'WP'
  const number = detailNumberOf(rest)
  const view = renderPage(path ?? `/projects/${key}/issues/${number}`, { handlers: [...handlers, ...issueDetailHandlers(rest)] })
  await screen.findByTestId('issue-title-heading', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}
