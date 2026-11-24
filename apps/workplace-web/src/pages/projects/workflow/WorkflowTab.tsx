import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { apiErrorResponse, apiErrorStatus, extractApiError, isConflictError } from '@/lib/api-error'
import type { WorkflowDraftSession } from '@/lib/workflowDraftSessions'
import {
  getWorkflowDraftGeneration, getWorkflowDraftSessions, subscribeWorkflowDraftSessions,
  updateWorkflowDraftSession, workflowDraftStorageKey,
} from '@/lib/workflowDraftSessions'
import { olderRunsNotice, olderVersionRuns } from '@/lib/workflowRuns'
import {
  useWorkflow, useWorkflowVersion, useWorkflowVersions, workflowApi, type WorkflowDetail, workflowKeys, type WorkflowProblem,
} from '@/lib/workflows'

import { useProjectTabs } from '../tabs/ProjectTabsContext'
import type { ProjectWorkflowContext } from '../tabs/ProjectTabsLayout'
import { PublishDialog } from './PublishDialog'
import { WorkflowGraphEditor } from './WorkflowGraphEditor'
import { WorkflowGraphView } from './WorkflowGraphView'
import { WorkflowProblemsPanel, WorkflowValidationFailure } from './WorkflowProblemsPanel'
import { WorkflowRuns } from './WorkflowRuns'
import { workflowSelectClass, WorkflowVersions } from './WorkflowVersions'
import { countWorkflowYamlChanges } from './workflowYamlDiff'
import { WorkflowYamlEditor } from './WorkflowYamlEditor'

const VALIDATION_DELAY = 350
const NO_PROBLEMS: WorkflowProblem[] = []

/** 신원이 바뀐 뒤 도착한 초안 응답은 새 사용자·테넌트 화면에 이어 쓰지 않는다. */
function assertWorkflowDraftGeneration(generation: number): void {
  if (generation !== getWorkflowDraftGeneration()) throw new Error('워크플로우 세션이 변경되었습니다.')
}
const YAML_VIEW = 'YAML'

/** 목록은 레이아웃에서 받아 탭을 선택해도 같은 프로젝트 조회를 되풀이하지 않는다. */
export default function WorkflowTab() {
  const { project } = useProjectTabs()
  const { canManage, workflows } = useOutletContext<ProjectWorkflowContext>()
  useDocumentTitle(['워크플로우', project.name])

  return <WorkflowWorkspace key={project.id} projectId={project.id} canManage={canManage} workflows={workflows} />
}

/** 프로젝트가 바뀌면 선택을 초기화하고, 워크플로우를 만들면 받은 상세를 바로 연다. */
function WorkflowWorkspace({ projectId, canManage, workflows }: ProjectWorkflowContext & { projectId: number }) {
  const { user, activeTenant, isLoggingOut } = useAuth()
  const draftStorageKey = workflowDraftStorageKey(user?.id, activeTenant?.tenantId, projectId)
  // 고른 정의는 주소 `?workflow=` 에 둔다(이슈 카드 「실행 보기 ↗」가 그 실행의 정의를 바로 열게). 없거나 모르는 값이면 첫 정의.
  const [workspaceParams, setWorkspaceParams] = useSearchParams()
  const selectedId = Number(workspaceParams.get('workflow')) || undefined
  /** 정의를 바꾼다 — 이전 정의의 실행(run)·모아 보기(runsView)와 하위 보기(view)는 지운다 — 만들기·바꾸기 모두 편집기로 연다. */
  const selectWorkflow = useCallback((workflowId: number) => {
    setWorkspaceParams((prev) => {
      const params = new URLSearchParams(prev)
      params.set('workflow', String(workflowId))
      params.delete('run')
      params.delete('runsView')
      params.delete('view')
      return params
    }, { replace: true })
  }, [setWorkspaceParams])
  const [creating, setCreating] = useState(false)
  const subscribe = useCallback((listener: () => void) => subscribeWorkflowDraftSessions(draftStorageKey, listener), [draftStorageKey])
  const getSnapshot = useCallback(() => getWorkflowDraftSessions(draftStorageKey), [draftStorageKey])
  const drafts = useSyncExternalStore(subscribe, getSnapshot, () => getWorkflowDraftSessions(null))
  const queryClient = useQueryClient()
  const summaries = workflows.data ?? []
  useUnsavedChangesWarning([...drafts.values()].some(({ edit }) => edit !== null))

  const selected = summaries.find((item) => item.id === selectedId) ?? summaries[0]
  const id = selected?.id
  const detail = useWorkflow(id)

  // 고른 워크플로우만 화면에 마운트하되 입력과 충돌 상태는 각 정의 id 로 보관한다.
  function updateDraft(workflowId: number, draft: WorkflowDraftSession | null, generation?: number) {
    if (isLoggingOut) return
    updateWorkflowDraftSession(draftStorageKey, workflowId, draft, generation)
  }

  const create = useMutation({
    mutationFn: async (name: string) => {
      if (isLoggingOut) throw new Error('로그아웃 중에는 워크플로우를 변경할 수 없습니다.')
      const generation = getWorkflowDraftGeneration()
      const item = await workflowApi.create(projectId, name, `schema: genia/workflow@1\nname: ${JSON.stringify(name)}\nroles: {}\nnodes: {}\nstart: []\n`)
      assertWorkflowDraftGeneration(generation)
      return { item, generation }
    },
    onSuccess: async ({ item, generation }) => {
      if (generation !== getWorkflowDraftGeneration() || isLoggingOut) return
      await queryClient.cancelQueries({ queryKey: workflowKeys.list(projectId) })
      if (generation !== getWorkflowDraftGeneration() || isLoggingOut) return
      queryClient.setQueryData(workflowKeys.detail(item.id), item)
      queryClient.setQueryData<typeof summaries>(workflowKeys.list(projectId), (previous) => [
        ...(previous ?? []).filter((summary) => summary.id !== item.id),
        { id: item.id, name: item.name, enabled: item.enabled, activeVersionNo: null, draftChanged: true },
      ])
      selectWorkflow(item.id)
      setCreating(false)
      void queryClient.invalidateQueries({ queryKey: workflowKeys.list(projectId) })
      toast.success('워크플로우 초안을 만들었습니다.')
    },
  })

  return (
    <Page.Body className="space-y-4">
      {!workflows.data && workflows.isPending && <p className="text-sm text-muted-foreground">워크플로우를 불러오는 중…</p>}
      {!workflows.data && workflows.isError && (
        <p role="alert" className="text-sm">
          워크플로우를 불러오지 못했습니다. <Button variant="link" size="sm" onClick={() => void workflows.refetch()}>다시 불러오기</Button>
        </p>
      )}
      {workflows.data && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {id !== undefined ? (
              <select
                aria-label="워크플로우 선택"
                className={workflowSelectClass}
                value={id}
                onChange={(event) => selectWorkflow(Number(event.target.value))}
              >
                {summaries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            ) : <p className="text-sm text-muted-foreground">아직 등록된 워크플로우가 없습니다.</p>}
            {canManage && (
              <Button variant="outline" size="sm" disabled={isLoggingOut} onClick={() => { create.reset(); setCreating(true) }}>워크플로우 만들기</Button>
            )}
          </div>
          {id !== undefined && !detail.data && detail.isPending && <p className="text-sm text-muted-foreground">워크플로우를 불러오는 중…</p>}
          {id !== undefined && !detail.data && detail.isError && (
            <p role="alert" className="text-sm">
              워크플로우를 불러오지 못했습니다. <Button variant="link" size="sm" onClick={() => void detail.refetch()}>다시 불러오기</Button>
            </p>
          )}
          {detail.data && (
            <SelectedWorkflow
              key={detail.data.id}
              detail={detail.data}
              draft={drafts.get(detail.data.id)}
              updateDraft={updateDraft}
              reload={() => workflowApi.get(detail.data.id)}
              canManage={canManage}
              isLoggingOut={isLoggingOut}
              draftChanged={selected?.draftChanged === true}
            />
          )}
        </>
      )}
      {canManage && (
        <CreateWorkflowDialog
          open={creating && !isLoggingOut}
          onOpenChange={(open) => { if (!create.isPending && !isLoggingOut) setCreating(open) }}
          busy={create.isPending || isLoggingOut}
          error={create.isError ? extractApiError(create.error, '워크플로우를 만들지 못했습니다.') : null}
          onCreate={(name) => create.mutate(name)}
        />
      )}
    </Page.Body>
  )
}

/** 이름을 받은 뒤 편집을 시작할 YAML 초안을 만든다. */
function CreateWorkflowDialog({ open, onOpenChange, onCreate, busy, error }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string) => void
  busy: boolean
  error: string | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>워크플로우 만들기</DialogTitle>
          <DialogDescription>워크플로우의 이름을 입력합니다.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault()
          const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
          if (name) onCreate(name)
        }}>
          <label className="grid gap-1 text-sm font-medium">
            이름
            <Input name="name" maxLength={100} required disabled={busy} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" disabled={busy}>{busy ? '만드는 중…' : '만들기'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface DraftEdit {
  yaml: string
  expectedDraftUpdatedAt: string
  baseYaml: string
}

interface PublishConfirmation {
  yaml: string
  edit: DraftEdit | null
  expectedDraftUpdatedAt: string
}

type WorkflowAction =
  | { type: 'save' }
  | { type: 'reload' }
  | { type: 'publish'; confirmation: PublishConfirmation }
  | { type: 'restore'; versionNo: number; expectedDraftUpdatedAt: string }

/** 입력을 시작할 때 본 초안 시각을 고정해, 백그라운드 조회가 다른 사람의 변경을 덮게 하지 않는다. */
function SelectedWorkflow({ detail, canManage, isLoggingOut, draftChanged, draft, updateDraft, reload }: {
  detail: WorkflowDetail
  canManage: boolean
  isLoggingOut: boolean
  draftChanged: boolean
  draft: WorkflowDraftSession | undefined
  updateDraft: (workflowId: number, draft: WorkflowDraftSession | null, generation?: number) => void
  reload: () => Promise<WorkflowDetail>
}) {
  const { id, projectId, activeVersion } = detail
  // 하위 보기는 주소 `?view=` 에 묶는다(이슈 카드 「실행 보기 ↗」가 바로 열 수 있게). 모르는 값은 편집. 바꿀 때는 replace 로 쓰고, 실행을 떠나면 run·runsView 를 지운다.
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = searchParams.get('view')
  const panel = viewParam === 'runs' || viewParam === 'versions' ? viewParam : 'editor'
  const setPanel = useCallback((next: string) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.set('view', next)
      if (next !== 'runs') { params.delete('run'); params.delete('runsView') }
      return params
    }, { replace: true })
  }, [setSearchParams])
  const [mode, setMode] = useState<'yaml' | 'graph'>('yaml')
  const [publishConfirmation, setPublishConfirmation] = useState<PublishConfirmation | null>(null)
  const [workError, setWorkError] = useState<string | null>(null)
  const [publishedHere, setPublishedHere] = useState<{ versionNo: number; yaml: string } | null>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const { project } = useProjectTabs()
  const { user } = useAuth()
  const { askWithPrompt } = useAssistant()
  // 게시 응답의 번호와 확인한 원문을 먼저 쓰고, 게시본 상세는 서버에서 다시 받는다.
  const activeVersionNo = Math.max(publishedHere?.versionNo ?? 0, activeVersion?.no ?? 0) || null
  const versions = useWorkflowVersions(id, activeVersionNo !== null || panel === 'versions')
  const publishedByThisEditor = publishedHere?.versionNo === activeVersionNo
  const needsPublishedVersion = !canManage || mode === 'graph' || !publishedByThisEditor
  const published = useWorkflowVersion(id, needsPublishedVersion ? activeVersionNo : null)
  const edit = canManage ? draft?.edit ?? null : null
  const conflict = canManage && draft?.conflict === true
  const validation = useDraftValidation(projectId, edit)
  const problems = edit ? validation.problems : detail.draftProblems
  const yaml = edit?.yaml ?? detail.draftYaml
  const expected = edit?.expectedDraftUpdatedAt ?? detail.draftUpdatedAt
  const running = activeVersionNo === null ? 0 : versions.data?.reduce((total, version) => total + version.activeRuns, 0) ?? null
  const checkingRunCount = activeVersionNo !== null && (versions.isFetching || versions.isError)
  const publishedYaml = activeVersionNo === null ? '' : published.data?.sourceYaml
    ?? (publishedByThisEditor ? publishedHere?.yaml : undefined)
  // 모아 보기 그래프가 빼는 옛 버전 실행의 안내 — 머리글 수와 같은 versions 에서 만든다(WP-2044).
  const olderNotice = useMemo(
    () => olderRunsNotice(olderVersionRuns(versions.data, activeVersionNo), activeVersionNo),
    [versions.data, activeVersionNo],
  )
  const unpostedChanges = useMemo(
    () => canManage && publishedYaml !== undefined ? countWorkflowYamlChanges(publishedYaml, yaml) : null,
    [canManage, publishedYaml, yaml],
  )
  let changeCountLabel = '게시 안 한 변경 수 확인 중'
  if (unpostedChanges !== null) changeCountLabel = '게시 안 한 변경 ' + unpostedChanges
  else if (published.isError) changeCountLabel = '게시 안 한 변경 수를 불러오지 못했습니다.'

  // 응답으로 받은 초안을 먼저 반영하고 목록의 배지는 백그라운드에서 맞춘다.
  async function acceptDraft(updated: Pick<WorkflowDetail, 'draftYaml' | 'draftUpdatedAt' | 'draftProblems'>, generation: number) {
    await queryClient.cancelQueries({ queryKey: workflowKeys.detail(id), exact: true })
    assertWorkflowDraftGeneration(generation)
    queryClient.setQueryData<WorkflowDetail>(workflowKeys.detail(id), (current) => ({ ...(current ?? detail), ...updated }))
    updateDraft(id, null, generation)
    void queryClient.invalidateQueries({ queryKey: workflowKeys.list(projectId) })
  }

  /** 초안 저장이 성공한 응답만 받아 편집과 충돌 상태를 지운다. */
  async function saveDraft(input: DraftEdit, generation: number) {
    const saved = await workflowApi.saveDraft(id, input.yaml, input.expectedDraftUpdatedAt)
    assertWorkflowDraftGeneration(generation)
    await acceptDraft({ draftYaml: input.yaml, draftUpdatedAt: saved.draftUpdatedAt, draftProblems: saved.problems }, generation)
    return saved
  }

  const write = useMutation({
    mutationKey: workflowKeys.detail(id),
    mutationFn: async (action: WorkflowAction) => {
      if (isLoggingOut) throw new Error('로그아웃 중에는 워크플로우를 변경할 수 없습니다.')
      const generation = getWorkflowDraftGeneration()
      setWorkError(null)
      let unsavedEdit = edit
      try {
        if (action.type === 'reload') {
          await acceptDraft(await reload(), generation)
          return
        }
        if (action.type === 'restore') {
          const restored = await workflowApi.restoreDraft(id, action.versionNo, action.expectedDraftUpdatedAt)
          assertWorkflowDraftGeneration(generation)
          await acceptDraft(restored, generation)
          setMode('yaml')
          setPanel('editor')
          toast.success('버전을 초안으로 복원했습니다.')
          return
        }
        if (action.type === 'save') {
          if (edit) {
            await saveDraft(edit, generation)
            toast.success('초안을 저장했습니다.')
          }
          return
        }

        // 확인 창에서 본 초안을 사용한다. 먼저 저장했다면 그 쓰기의 시각으로만 게시할 수 있다.
        const { confirmation } = action
        let publishTime = confirmation.expectedDraftUpdatedAt
        unsavedEdit = confirmation.edit
        if (confirmation.edit) {
          const saved = await saveDraft(confirmation.edit, generation)
          unsavedEdit = null
          publishTime = saved.draftUpdatedAt
          if (saved.problems.some((problem) => problem.severity === 'ERROR')) {
            // 초안은 저장됐으므로 게시가 멈춘 이유를 편집기의 진단과 함께 보여 준다.
            setWorkError('초안을 저장했습니다. 검증 결과의 오류를 고친 뒤 다시 게시해 주세요.')
            setPublishConfirmation(null)
            setMode('yaml')
            return
          }
        }
        // 로그아웃·로그인·테넌트 전환이 저장 도중 끝났다면 이전 화면의 게시 요청을 새 토큰으로 보내지 않는다.
        assertWorkflowDraftGeneration(generation)
        const result = await workflowApi.publish(id, publishTime)
        assertWorkflowDraftGeneration(generation)
        setPublishConfirmation(null)
        setPublishedHere({ versionNo: result.versionNo, yaml: confirmation.yaml })
        void queryClient.invalidateQueries({ queryKey: workflowKeys.detail(id) })
        void queryClient.invalidateQueries({ queryKey: workflowKeys.list(projectId) })
        const count = result.runningRunsOnOlderVersions
        if (count > 0) {
          toast.success('버전 ' + result.versionNo + ' 게시 완료 · 실행 ' + count + '개는 기존 버전에서 계속됩니다.')
        } else {
          toast.success('버전 ' + result.versionNo + '을 게시했습니다.')
        }
      } catch (error) {
        if (generation !== getWorkflowDraftGeneration()) throw error
        setPublishConfirmation(null)
        if (isConflictError(error) && action.type !== 'reload') {
          updateDraft(id, { edit: unsavedEdit, conflict: true }, generation)
          throw error
        }
        if (action.type === 'publish' && apiErrorStatus(error) === 422) {
          const response = apiErrorResponse(error) as { problems?: WorkflowProblem[] } | null
          if (response?.problems) {
            queryClient.setQueryData<WorkflowDetail>(workflowKeys.detail(id), (current) => current && ({
              ...current, draftProblems: response.problems ?? [],
            }))
            setMode('yaml')
          }
        }
        setWorkError(extractApiError(error, '워크플로우 작업을 완료하지 못했습니다.'))
        throw error
      }
    },
  })

  // 전환 중에도 같은 정의로 돌아오면 쓰기 응답이 올 때까지 입력을 막는다.
  const busy = useIsMutating({ mutationKey: workflowKeys.detail(id), exact: true }) > 0
  const hasErrors = problems.some((problem) => problem.severity === 'ERROR')
  // 검증 요청에 실패하면 진단 목록이 비어 있어도 검증이 끝날 때까지 게시를 막는다.
  const canPublish = canManage && !isLoggingOut && !conflict && !busy && !validation.pending && !validation.failed && !hasErrors

  // YAML 편집기와 그래프 편집기가 같은 초안 갱신 규칙을 쓴다 — 기준 YAML 과 같아지면 편집을 지운다.
  function editDraft(updated: string) {
    const baseYaml = edit?.baseYaml ?? detail.draftYaml
    updateDraft(id, updated === baseYaml && !conflict ? null : {
      edit: { yaml: updated, expectedDraftUpdatedAt: expected, baseYaml },
      conflict,
    })
  }

  // 그래프의 오류 단추가 사라지면 새로 열린 YAML 편집기로 포커스를 옮긴다.
  function openYamlDiagnostics() {
    flushSync(() => setMode('yaml'))
    editor.current?.focus()
  }

  // 복원 뒤 다이얼로그가 이전 위치에 포커스를 돌려줘도 선택한 편집 화면을 유지한다.
  return (
    <Tabs value={panel} onValueChange={setPanel} activationMode="manual" className="gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{activeVersionNo !== null ? `게시 버전 ${activeVersionNo}` : '게시 전'}</span>
        <span>{detail.enabled ? '사용 중' : '사용 안 함'}</span>
        {canManage && draftChanged && <span>게시 전 초안</span>}
      </div>
      <TabsList aria-label="워크플로우 보기">
        <TabsTrigger value="editor">편집</TabsTrigger>
        <TabsTrigger value="runs">{running === null ? '실행' : `실행 ${running}`}</TabsTrigger>
        <TabsTrigger value="versions">버전</TabsTrigger>
      </TabsList>
      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm">
          <p>다른 곳에서 초안이 바뀌었습니다. 최신 초안을 불러오면 현재 편집 내용이 바뀝니다.</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => write.mutate({ type: 'reload' })}>최신 초안 불러오기</Button>
        </div>
      )}
      {workError && <p role="alert" className="text-sm text-destructive">{workError}</p>}
      <TabsContent value="editor" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1" role="group" aria-label="워크플로우 표시 방식">
            <Button size="sm" variant={mode === 'graph' ? 'secondary' : 'ghost'} aria-pressed={mode === 'graph'} onClick={() => setMode('graph')}>그래프</Button>
            <Button size="sm" variant={mode === 'yaml' ? 'secondary' : 'ghost'} aria-pressed={mode === 'yaml'} onClick={() => setMode('yaml')}>{YAML_VIEW}</Button>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground" role="status">
                {changeCountLabel}
              </span>
              <Button size="sm" variant="ghost" disabled={!edit || busy || conflict || isLoggingOut} onClick={() => updateDraft(id, null)}>되돌리기</Button>
              <Button size="sm" variant="outline" disabled={!edit || busy || conflict || isLoggingOut} onClick={() => write.mutate({ type: 'save' })}>초안 저장</Button>
              <Button size="sm" disabled={!canPublish} onClick={() => setPublishConfirmation({ yaml, edit, expectedDraftUpdatedAt: expected })}>게시</Button>
            </div>
          )}
        </div>
        {mode === 'graph' && canManage && (validation.pending || validation.failed || hasErrors) && (
          <div role="status" className="text-sm text-muted-foreground">
            {validation.pending && '검증 중…'}
            {validation.failed && <WorkflowValidationFailure onRetry={validation.retry} />}
            {/* 「YAML 오류 확인」 단추는 그래프 아래 경고 줄에 있다 — 같은 이름의 단추를 둘 두지 않는다 */}
            {hasErrors && 'YAML에 오류가 있어 게시할 수 없습니다.'}
          </div>
        )}
        {mode === 'yaml' && canManage ? (
          <div className="@container">
            <div className="grid min-w-0 items-start gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(14rem,30%)]">
              <WorkflowYamlEditor
                yaml={yaml}
                textareaRef={editor}
                problems={problems}
                onChange={editDraft}
                readOnly={busy || isLoggingOut}
              />
              <WorkflowProblemsPanel
                problems={problems}
                checking={validation.pending}
                failed={validation.failed}
                onSelect={(problem) => { if (editor.current) focusWorkflowProblem(editor.current, problem) }}
                onRetry={validation.retry}
                onAskFix={() => askWithPrompt([
                  '다음 워크플로우 YAML의 검증 문제를 검토하고 고친 YAML을 제안해 주세요.',
                  '워크플로우 YAML:',
                  yaml,
                  '서버 검증 결과:',
                  JSON.stringify(problems, null, 2),
                ].join('\n'))}
              />
            </div>
          </div>
        ) : mode === 'graph' && canManage ? (
          <WorkflowGraphEditor
            yaml={yaml}
            problems={problems}
            readOnly={busy || isLoggingOut}
            onChange={editDraft}
            onOpenYaml={openYamlDiagnostics}
          />
        ) : (
          <PublishedWorkflow
            mode={mode}
            published={published}
            hasVersion={activeVersionNo !== null}
            editor={editor}
          />
        )}
      </TabsContent>
      <TabsContent value="runs">
        {/* 진행 중인 실행 수 문구는 목록 머리(WorkflowRuns)로 옮겼다. */}
        <WorkflowRuns workflowId={id} projectKey={project.key} activeVersionNo={activeVersionNo} canManage={canManage} canRecover={project.viewerIsMember} meId={user?.id ?? 0}
          runningCount={running} runningFailed={running === null && versions.isError} onRetryRunning={() => void versions.refetch()}
          olderNotice={olderNotice} />
      </TabsContent>
      <TabsContent value="versions">
        <WorkflowVersions
          id={id}
          versions={versions}
          canManage={canManage}
          busy={busy || conflict}
          expectedDraftUpdatedAt={expected}
          onRestore={(versionNo, expectedDraftUpdatedAt) => write.mutate({ type: 'restore', versionNo, expectedDraftUpdatedAt })}
        />
      </TabsContent>
      {canManage && (
        <PublishDialog
          open={publishConfirmation !== null}
          onOpenChange={(open) => { if (!open && !busy) setPublishConfirmation(null) }}
          canPublish={!conflict && !busy}
          publishing={busy}
          running={checkingRunCount ? null : running}
          runningLoadError={versions.isError && !versions.isFetching}
          onRetryRunning={() => void versions.refetch()}
          onPublish={() => { if (publishConfirmation) write.mutate({ type: 'publish', confirmation: publishConfirmation }) }}
        />
      )}
    </Tabs>
  )
}

/** 그래프와 읽기 전용 YAML은 저장된 게시 버전에서 읽는다. */
function PublishedWorkflow({ published, hasVersion, mode, editor }: {
  published: ReturnType<typeof useWorkflowVersion>
  hasVersion: boolean
  mode: 'yaml' | 'graph'
  editor: React.Ref<HTMLTextAreaElement>
}) {
  if (!hasVersion) return <p className="text-sm text-muted-foreground">게시한 버전이 없습니다.</p>
  if (published.isPending) return <p className="text-sm text-muted-foreground">게시 버전을 불러오는 중…</p>
  if (!published.data) return (
    <p role="alert" className="text-sm">
      게시 버전을 불러오지 못했습니다. <Button variant="link" size="sm" onClick={() => void published.refetch()}>다시 불러오기</Button>
    </p>
  )
  if (mode === 'graph') return <WorkflowGraphView model={published.data.model} readOnly={true} />
  return <WorkflowYamlEditor yaml={published.data.sourceYaml} textareaRef={editor} problems={NO_PROBLEMS} readOnly onChange={() => {}} />
}

/** 최근 입력만 지연 검증한다. 이전 요청은 취소하고 지난 진단은 입력 위에 남겨 두지 않는다. */
function useDraftValidation(projectId: number, edit: DraftEdit | null) {
  const [result, setResult] = useState<{ edit: DraftEdit; problems: WorkflowProblem[]; failed: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!edit) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void workflowApi.validate(projectId, edit.yaml, controller.signal).then(
        ({ problems }) => { if (!controller.signal.aborted) setResult({ edit, problems, failed: false }) },
        () => { if (!controller.signal.aborted) setResult({ edit, problems: NO_PROBLEMS, failed: true }) },
      )
    }, VALIDATION_DELAY)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [projectId, edit, attempt])

  const current = edit && result?.edit === edit ? result : null
  return {
    problems: current?.problems ?? NO_PROBLEMS,
    pending: edit !== null && current === null,
    failed: current?.failed ?? false,
    retry: () => {
      setResult(null)
      setAttempt((previous) => previous + 1)
    },
  }
}

/** 서버의 1부터 시작하는 UTF-16 행·열을 textarea 의 선택 위치로 바꾼다. */
function focusWorkflowProblem(editor: HTMLTextAreaElement, problem: WorkflowProblem) {
  const lines = editor.value.split('\n')
  const lineIndex = Math.min(Math.max(problem.line - 1, 0), lines.length - 1)
  const lineStart = lines.slice(0, lineIndex).reduce((offset, line) => offset + line.length + 1, 0)
  const columnOffset = Math.min(Math.max(problem.column - 1, 0), lines[lineIndex].length)
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight)

  editor.focus()
  editor.setSelectionRange(lineStart + columnOffset, lineStart + columnOffset)
  const lineTop = lineIndex * lineHeight
  if (lineTop < editor.scrollTop || lineTop + lineHeight > editor.scrollTop + editor.clientHeight) {
    editor.scrollTop = Math.max(0, lineTop - editor.clientHeight / 2)
  }
}
