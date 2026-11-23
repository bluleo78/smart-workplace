import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { type ReactNode, useEffect } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'

import { AIAssistantProvider, useAssistant } from '@/components/ai/AIAssistantContext'
import { projectKeys } from '@/hooks/queries/useProjects'
import { clearWorkflowDraftSessions } from '@/lib/workflowDraftSessions'
import { workflowKeys } from '@/lib/workflows'
import { ProjectTabsLayout } from '@/pages/projects/tabs/ProjectTabsLayout'
import WorkflowTab from '@/pages/projects/workflow/WorkflowTab'
import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/renderWithProviders'

const base = '/api/v1'
export const draftTime = '2026-11-22T10:00:00Z'
export const nextDraftTime = '2026-11-22T10:00:01Z'
const originalYaml = 'name: 정리\nnodes:\n  review: {}'
export const olderYaml = 'name: 초안\nnodes:\n  check: {}'
export const workflowProblem = {
  severity: 'ERROR', code: 'INVALID_NODE', message: '노드를 확인하세요.', line: 3, column: 3, nodeKey: 'review',
}

// 화면 회귀 테스트는 앱의 세션 초안 저장소를 공유하지 않도록 각 테스트 앞뒤로 비운다.
beforeEach(() => {
  clearWorkflowDraftSessions()
  window.sessionStorage.clear()
})
afterEach(() => {
  clearWorkflowDraftSessions()
  window.sessionStorage.clear()
})

/** 실행 전인 실제 서버처럼 활성 버전과 초안을 따로 유지하는 기본 응답. */
export const workflowDetail = {
  id: 42, projectId: 7, name: '작업 정리', enabled: false,
  activeVersion: { no: 2, createdAt: draftTime, createdBy: null },
  draftYaml: originalYaml, draftUpdatedAt: draftTime, draftProblems: [],
}

/** 편집기와 탭 레이아웃을 같은 네트워크 계약으로 띄운다. */
export function renderWorkflow({ manager = true, empty = false, enterTab = true, personal = false, multiple = false }: {
  manager?: boolean; empty?: boolean; enterTab?: boolean; personal?: boolean; multiple?: boolean
} = {}) {
  const summary = { id: 42, name: '작업 정리', enabled: false, activeVersionNo: 2, draftChanged: false }
  const summaries = multiple ? [summary, { ...summary, id: 43, name: '다른 워크플로우', activeVersionNo: null }] : [summary]
  let currentSummaries = empty ? [] : summaries
  const getSummaries = vi.fn(() => HttpResponse.json(currentSummaries))
  let canManage = manager
  let viewerRole: 'OWNER' | 'MEMBER' | undefined = 'MEMBER'
  if (manager) viewerRole = 'OWNER'
  if (personal) viewerRole = undefined
  server.use(
    http.get(base + '/projects/WP', () => HttpResponse.json({
      id: 7, key: 'WP', name: '업무', type: personal ? 'PERSONAL' : 'TEAM', ownerId: canManage ? 1 : 2,
      viewerIsMember: true, viewerRole: canManage ? viewerRole : 'MEMBER',
    })),
    http.get(base + '/wiki/project-spaces/WP', () => new HttpResponse(null, { status: 404 })),
    http.get(base + '/projects/7/workflows', getSummaries),
    http.get(base + '/workflows/42', () => HttpResponse.json(workflowDetail)),
    http.get(base + '/workflows/43', () => HttpResponse.json({
      ...workflowDetail, id: 43, name: '다른 워크플로우', activeVersion: null, draftYaml: 'name: 다른 초안',
    })),
    http.get(base + '/workflows/42/versions', () => HttpResponse.json([
      { versionNo: 2, createdAt: draftTime, createdBy: null, activeRuns: 3 },
      { versionNo: 1, createdAt: '2026-11-21T10:00:00Z', createdBy: null, activeRuns: 1 },
    ])),
    http.get(base + '/workflows/42/versions/2', () => HttpResponse.json({
      versionNo: 2, sourceYaml: originalYaml,
      model: { nodes: [{ key: 'review', type: 'human_task', name: '살펴보기' }] },
    })),
    http.get(base + '/workflows/42/versions/1', () => HttpResponse.json({
      versionNo: 1, sourceYaml: olderYaml,
      model: { nodes: [{ key: 'check', type: 'agent_task', name: '확인' }] },
    })),
  )
  const target = enterTab ? '/projects/WP/workflow' : '/projects/WP/overview'
  /** 어시스턴트가 실제로 받은 작성 대기 문구를 검증한다. */
  function PromptProbe() {
    const { promptSeed } = useAssistant()
    return <output hidden data-testid="assistant-prompt">{promptSeed?.text}</output>
  }

  let queryClient: QueryClient
  function TestShell({ children }: { children: ReactNode }) {
    const client = useQueryClient()
    useEffect(() => { queryClient = client }, [client])
    return <AIAssistantProvider hotkeysEnabled={false}>{children}<PromptProbe /></AIAssistantProvider>
  }

  renderWithProviders(
    <TestShell><Routes>
      <Route path="/" element={<Navigate to={target} replace />} />
      <Route path="/projects/:key" element={<ProjectTabsLayout />}>
        <Route path="overview" element={<p>개요 본문 <Link to="/projects/WP/workflow">워크플로우로 돌아가기</Link></p>} />
        <Route path="workflow" element={<WorkflowTab />} />
      </Route>
    </Routes></TestShell>,
  )
  return {
    getSummaries,
    setSummaries: (next: typeof summaries) => { currentSummaries = next },
    setManager: (next: boolean) => { canManage = next },
    refreshWorkflow: () => queryClient.invalidateQueries({ queryKey: workflowKeys.detail(42), exact: true }),
    refreshSummaries: () => queryClient.invalidateQueries({ queryKey: workflowKeys.list(7), exact: true }),
    refreshProject: () => queryClient.invalidateQueries({ queryKey: projectKeys.detail('WP'), exact: true }),
  }
}
