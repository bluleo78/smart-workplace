// 이슈 만들기 대화상자 화면 테스트 도우미(WP-1002) — 목록 화면 전체 대신 대화상자(IssueCreateDialog)와 그것을 여는 「+ 새 태스크」 버튼만 띄운다.
// 프로젝트 상세 화면은 open 상태 하나로 대화상자를 열고 닫는다(ProjectDetailPage 의 open/setOpen). 같은 배선을 작은 감싸개로 두어
// 닫았다 다시 여는 판정(입력·오류 초기화)도 화면과 같은 경로로 지난다.
import { http, HttpResponse, type RequestHandler } from 'msw'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { IssueCreateDialog } from '@/pages/projects/components/IssueCreateDialog'
import { renderScreen } from '@/test/renderScreen'

import { systemTypes } from '../../../../e2e/factories/issueType.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

/** 「+ 새 태스크」 버튼 + 대화상자 — 프로젝트 상세 화면 헤더와 같은 열기/닫기 배선. */
function CreateDialogHarness({ projectKey }: { projectKey: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ 새 태스크</Button>
      <IssueCreateDialog projectKey={projectKey} open={open} onOpenChange={setOpen} />
    </>
  )
}

/**
 * 대화상자를 띄울 준비를 한다(아직 닫힘) — 프로젝트(TEAM)·유형(시스템 유형)과 대화상자가 부르는 나머지 프로젝트 하위 목록(멤버·라벨·
 * 마일스톤 등)은 빈 목록으로 깐다. handlers 가 먼저 잡는다(생성 POST 등).
 */
export function renderCreateDialog(projectKey: string, handlers: RequestHandler[] = []) {
  return renderScreen(<CreateDialogHarness projectKey={projectKey} />, {
    path: `/projects/${projectKey}`,
    handlers: [
      ...handlers,
      http.get(`/api/v1/projects/${projectKey}`, () => HttpResponse.json(createProject({ key: projectKey }))),
      http.get(`/api/v1/projects/${projectKey}/types`, () => HttpResponse.json(systemTypes())),
      http.get(`/api/v1/projects/${projectKey}/:sub`, () => HttpResponse.json([])),
    ],
  })
}
