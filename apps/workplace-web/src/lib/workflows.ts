import { useQuery } from '@tanstack/react-query'

import { client } from '@/api/client'

/** 프로젝트 탭과 목록에서 공유하는 워크플로우 요약. */
export interface WorkflowSummary {
  id: number
  name: string
  enabled: boolean
  activeVersionNo: number | null
  draftChanged: boolean
}

/** 편집기가 서버 진단을 가리킬 수 있도록 행·열은 1부터 센다. */
export interface WorkflowProblem {
  severity: 'ERROR' | 'WARNING'
  code: string
  message: string
  line: number
  column: number
  nodeKey: string | null
}

interface WorkflowActor {
  id: number
  username: string
  name: string
}

/** 초안과 지금 실행에 쓰는 게시 버전을 별도로 받는다. */
export interface WorkflowDetail {
  id: number
  projectId: number
  name: string
  enabled: boolean
  activeVersion: { no: number; createdAt: string; createdBy: WorkflowActor | null } | null
  draftYaml: string
  draftUpdatedAt: string
  draftProblems: WorkflowProblem[]
}

export interface WorkflowVersionSummary {
  versionNo: number
  createdAt: string
  createdBy: WorkflowActor | null
  activeRuns: number
}

/** 저장 모델에서 순서가 필요한 역할·노드·결과는 키를 가진 배열로 온다. */
export interface WorkflowModel {
  schema: string
  name?: string
  roles: { key: string; name?: string; memberUsernames: string[] }[]
  shared: { key: string; text: string }[]
  nodes: WorkflowModelNode[]
  start: WorkflowCondition[]
  layout: { key: string; x: number; y: number }[]
}

interface WorkflowCondition {
  assigneeRole?: string
  contextKey?: string
  equalsValue?: string | number | boolean
  to: string
}

export interface WorkflowModelNode {
  key: string
  type: string
  name?: string
  roleKey?: string
  instructions?: string
  use: string[]
  requires: string[]
  outputs: { key: string; type: string; required: boolean }[]
  outcomes: { key: string; to: string; assignTo?: string; requireComment: boolean }[]
  conditions: WorkflowCondition[]
  defaultTo?: string
  maxVisits?: number
  timeout?: { after: string; then?: string }
  onError?: { to: string; assignTo?: string }
  returnTo?: string
}

export interface WorkflowVersionDetail {
  versionNo: number
  sourceYaml: string
  model: WorkflowModel
}

interface WorkflowValidationResult {
  problems: WorkflowProblem[]
}

interface SaveDraftResult extends WorkflowValidationResult {
  draftUpdatedAt: string
}

interface PublishResult {
  versionNo: number
  runningRunsOnOlderVersions: number
}

/** 조회·저장·복원에서 같은 캐시를 쓰기 위한 키. */
export const workflowKeys = {
  list: (projectId: number | undefined) => ['workflows', 'project', projectId] as const,
  detail: (id: number | undefined) => ['workflows', 'detail', id] as const,
  versions: (id: number) => [...workflowKeys.detail(id), 'versions'] as const,
  version: (id: number, no: number | null) => [...workflowKeys.versions(id), no] as const,
}

/** 목록은 레이아웃에서 한 번 읽어 탭 가시성과 본문에 함께 쓴다. */
export function useProjectWorkflows(projectId: number | undefined) {
  return useQuery({
    queryKey: workflowKeys.list(projectId),
    queryFn: ({ signal }) =>
      client.get<WorkflowSummary[]>(`/projects/${projectId}/workflows`, { signal }).then((r) => r.data),
    enabled: projectId != null,
  })
}

/** 선택한 정의의 현재 게시 버전과 초안. */
export function useWorkflow(id: number | undefined) {
  return useQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: ({ signal }) => client.get<WorkflowDetail>(`/workflows/${id}`, { signal }).then((r) => r.data),
    enabled: id != null,
  })
}

/** 비교와 실행 수를 읽는 게시 버전 목록. */
export function useWorkflowVersions(id: number, enabled = true) {
  return useQuery({
    queryKey: workflowKeys.versions(id),
    queryFn: ({ signal }) => client.get<WorkflowVersionSummary[]>(`/workflows/${id}/versions`, { signal }).then((r) => r.data),
    enabled,
  })
}

/** 게시 버전의 원문과 모델은 불변이므로 재조회 없이 쓴다. */
export function useWorkflowVersion(id: number, no: number | null) {
  return useQuery({
    queryKey: workflowKeys.version(id, no),
    queryFn: ({ signal }) => client.get<WorkflowVersionDetail>(`/workflows/${id}/versions/${no}`, { signal }).then((r) => r.data),
    enabled: no != null,
    staleTime: Infinity,
  })
}

/** 정의 API 쓰기와 저장 없는 검증. 초안을 기준으로 쓰는 세 요청은 모두 편집 기준 시각을 함께 보낸다. */
export const workflowApi = {
  get: (id: number) => client.get<WorkflowDetail>(`/workflows/${id}`).then((r) => r.data),
  create: (projectId: number, name: string, yaml: string) =>
    client.post<WorkflowDetail>(`/projects/${projectId}/workflows`, { name, yaml }).then((r) => r.data),
  validate: (projectId: number, yaml: string, signal: AbortSignal) =>
    client.post<WorkflowValidationResult>('/workflows/validate', { projectId, yaml }, { signal }).then((r) => r.data),
  saveDraft: (id: number, yaml: string, expectedDraftUpdatedAt: string) =>
    client.put<SaveDraftResult>(`/workflows/${id}/draft`, { yaml, expectedDraftUpdatedAt }).then((r) => r.data),
  publish: (id: number, expectedDraftUpdatedAt: string) =>
    client.post<PublishResult>(`/workflows/${id}/publish`, { expectedDraftUpdatedAt }).then((r) => r.data),
  restoreDraft: (id: number, no: number, expectedDraftUpdatedAt: string) =>
    client.post<WorkflowDetail>(`/workflows/${id}/versions/${no}/restore-draft`, { expectedDraftUpdatedAt }).then((r) => r.data),
}
