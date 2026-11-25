import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
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
import { apiErrorResponse, apiErrorStatus, extractApiError, extractApiErrorCode, isConflictError } from '@/lib/api-error'
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
import { addAskPath } from './graphYaml'
import { PublishDialog } from './PublishDialog'
import { WorkflowEnableSwitch } from './WorkflowEnableSwitch'
import { WorkflowGraphEditor } from './WorkflowGraphEditor'
import { WorkflowGraphView } from './WorkflowGraphView'
import { WorkflowProblemsBadge } from './WorkflowProblemsBadge'
import { WorkflowProblemsPanel } from './WorkflowProblemsPanel'
import { WorkflowRuns } from './WorkflowRuns'
import { workflowSelectClass, WorkflowVersions } from './WorkflowVersions'
import { workflowViewFromParam } from './workflowView'
import { countWorkflowYamlChanges } from './workflowYamlDiff'
import { WorkflowYamlEditor } from './WorkflowYamlEditor'

const VALIDATION_DELAY = 350
/** 헤더 상태 알약(게시 버전·사용 안 함·초안 있음)의 공통 모양. */
const STATUS_PILL = 'rounded border px-1.5 text-xs text-muted-foreground'
/** 탭 패널 공통 모양 — 남는 높이를 채우고 안에서 스크롤한다. 쌓는 간격(space-y-3)은 패널마다 따로 붙인다(그래프는 캔버스 하나라 불필요). */
const PANE = 'min-h-0 flex-1 overflow-y-auto p-4'
const NO_PROBLEMS: WorkflowProblem[] = []
// 게시 안 한 변경이 0 이라 게시를 끈 이유 — 단추 옆에 보이는 글자(WP-2043).
const NO_CHANGES_REASON = '바꾼 내용이 없어 게시할 것이 없습니다.'

/** 워크플로우 탭 머리 한 줄 — 선택기만 있는 빈 상태와 전체 머리가 같은 모양을 쓰게 한다. 좁으면 줄바꿈. */
function WorkflowHeader({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">{children}</div>
}

/** 켜기·게시가 다른 워크플로우와 시작 조건이 겹쳐 거절됐는지(409, errors.code) — 초안 충돌(같은 409)과 구분한다. */
function isStartOverlapError(error: unknown): boolean {
  return extractApiErrorCode(error) === 'WORKFLOW_START_CONDITION_OVERLAP'
}

/** 신원이 바뀐 뒤 도착한 초안 응답은 새 사용자·테넌트 화면에 이어 쓰지 않는다. */
function assertWorkflowDraftGeneration(generation: number): void {
  if (generation !== getWorkflowDraftGeneration()) throw new Error('워크플로우 세션이 변경되었습니다.')
}

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
  // 고르면 머리(선택 상자 포함)가 새 정의로 다시 그려지므로, 키보드 사용자의 초점이 사라지지 않게 새 선택 상자에 초점을 되돌린다.
  const refocusPicker = useRef(false)
  const selectWorkflow = useCallback((workflowId: number, refocus = false) => {
    // 초점 복귀는 선택 상자에서 직접 고른 때만 — 만들기·상세 실패 뒤에는 선택 상자로 초점을 옮기지 않는다
    refocusPicker.current = refocus
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
  // 상세를 기다리는 동안의 임시 머리(상세 없음)의 선택 상자는 초점을 받지 않는다 — 새 SelectedWorkflow 의 선택 상자가 그려질 때 받는다.
  const inSelected = Boolean(workflows.data && detail.data)
  // 상세 불러오기가 실패하면 초점 복귀 요청을 거둔다 — 선택 상자가 마운트되지 않는 동안 플래그가 남아, 나중에 다시 불러와 그려질 때 초점을 가로채지 않게 한다.
  useEffect(() => { if (detail.isError) refocusPicker.current = false }, [detail.isError, id])
  const pickerRef = useCallback((element: HTMLSelectElement | null) => {
    if (element && inSelected && refocusPicker.current) { refocusPicker.current = false; element.focus() }
  }, [inSelected])

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

  // 워크플로우 고르기 + 만들기 — 상세가 있으면 SelectedWorkflow 머리 줄 안에, 없으면 이 줄만 머리로 그린다.
  const picker = workflows.data ? (
    <>
      {id !== undefined ? (
        <select
          ref={pickerRef}
          aria-label="워크플로우 선택"
          className={workflowSelectClass}
          value={id}
          onChange={(event) => selectWorkflow(Number(event.target.value), true)}
        >
          {summaries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      ) : <p className="text-sm text-muted-foreground">아직 등록된 워크플로우가 없습니다.</p>}
      {canManage && (
        <Button variant="outline" size="sm" disabled={isLoggingOut} onClick={() => { create.reset(); setCreating(true) }}>워크플로우 만들기</Button>
      )}
    </>
  ) : null

  return (
    <Page.Body padded={false} data-testid="workflow-page-body">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!workflows.data && workflows.isPending && <p className="p-4 text-sm text-muted-foreground">워크플로우를 불러오는 중…</p>}
        {!workflows.data && workflows.isError && (
          <p role="alert" className="p-4 text-sm">
            워크플로우를 불러오지 못했습니다. <Button variant="link" size="sm" onClick={() => void workflows.refetch()}>다시 불러오기</Button>
          </p>
        )}
        {workflows.data && detail.data && (
          <SelectedWorkflow
            key={detail.data.id}
            picker={picker}
            detail={detail.data}
            draft={drafts.get(detail.data.id)}
            updateDraft={updateDraft}
            reload={() => workflowApi.get(detail.data.id)}
            canManage={canManage}
            isLoggingOut={isLoggingOut}
            draftChanged={selected?.draftChanged === true}
          />
        )}
        {workflows.data && !detail.data && (
          <>
            <WorkflowHeader>{picker}</WorkflowHeader>
            {id !== undefined && detail.isPending && <p className="p-4 text-sm text-muted-foreground">워크플로우를 불러오는 중…</p>}
            {id !== undefined && detail.isError && (
              <p role="alert" className="p-4 text-sm">
                워크플로우를 불러오지 못했습니다. <Button variant="link" size="sm" onClick={() => void detail.refetch()}>다시 불러오기</Button>
              </p>
            )}
          </>
        )}
      </div>
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
  | { type: 'publish'; confirmation: PublishConfirmation; enable?: boolean }
  | { type: 'restore'; versionNo: number; expectedDraftUpdatedAt: string }

/** 입력을 시작할 때 본 초안 시각을 고정해, 백그라운드 조회가 다른 사람의 변경을 덮게 하지 않는다. */
function SelectedWorkflow({ picker, detail, canManage, isLoggingOut, draftChanged, draft, updateDraft, reload }: {
  picker: ReactNode
  detail: WorkflowDetail
  canManage: boolean
  isLoggingOut: boolean
  draftChanged: boolean
  draft: WorkflowDraftSession | undefined
  updateDraft: (workflowId: number, draft: WorkflowDraftSession | null, generation?: number) => void
  reload: () => Promise<WorkflowDetail>
}) {
  const { id, projectId, activeVersion } = detail
  // 보기는 주소 `?view=` 에 묶는다(이슈 카드 「실행 보기 ↗」가 바로 열 수 있게). 기본·모르는 값은 그래프. 바꿀 때는 replace 로 쓰고, 실행을 떠나면 run·runsView 를 지운다.
  const [searchParams, setSearchParams] = useSearchParams()
  const view = workflowViewFromParam(searchParams.get('view'))
  const setView = useCallback((next: string) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.set('view', next)
      if (next !== 'runs') { params.delete('run'); params.delete('runsView') }
      return params
    }, { replace: true })
  }, [setSearchParams])
  const [publishConfirmation, setPublishConfirmation] = useState<PublishConfirmation | null>(null)
  const [workError, setWorkError] = useState<string | null>(null)
  // 첫 게시 대화상자의 「게시하고 바로 사용」 — 열 때마다 기본 켜짐으로 시작한다.
  const [enableOnPublish, setEnableOnPublish] = useState(true)
  const [publishedHere, setPublishedHere] = useState<{ versionNo: number; yaml: string } | null>(null)
  const editor = useRef<HTMLTextAreaElement | null>(null)
  // 검사 배지의 「YAML 오류 확인」으로 YAML 보기를 열면, 편집기가 그려지는 순간(콜백 ref) 초점을 옮긴다 — 보기 전환은 주소 갱신이라 바로 그려지지 않는다.
  const focusYamlOnOpen = useRef(false)
  const editorRef = useCallback((element: HTMLTextAreaElement | null) => {
    editor.current = element
    if (element && focusYamlOnOpen.current) {
      focusYamlOnOpen.current = false
      element.focus()
    }
  }, [])
  const queryClient = useQueryClient()
  const { project } = useProjectTabs()
  const { user } = useAuth()
  const { askWithPrompt } = useAssistant()
  // 게시 응답의 번호와 확인한 원문을 먼저 쓰고, 게시본 상세는 서버에서 다시 받는다.
  const activeVersionNo = Math.max(publishedHere?.versionNo ?? 0, activeVersion?.no ?? 0) || null
  const versions = useWorkflowVersions(id, activeVersionNo !== null || view === 'versions')
  const publishedByThisEditor = publishedHere?.versionNo === activeVersionNo
  const needsPublishedVersion = !canManage || view === 'graph' || !publishedByThisEditor
  const published = useWorkflowVersion(id, needsPublishedVersion ? activeVersionNo : null)
  const edit = canManage ? draft?.edit ?? null : null
  const conflict = canManage && draft?.conflict === true
  const validation = useDraftValidation(projectId, edit)
  const problems = edit ? validation.problems : detail.draftProblems
  // 배지는 검사 중에 이 세션의 마지막 성공 결과를 보인다(없으면 서버 초안 진단 — 첫 검사 전에 오류가 사라졌다 돌아오지 않게, 지난 결과로 표시).
  // 이때 목록은 지난 결과라 배지의 고치기 단추는 끈다(stale). 편집 중이 아니면 서버 초안 진단 그대로.
  // pending 은 이미 edit !== null 을 포함한다
  const badgeStale = validation.pending
  const badgeProblems = badgeStale ? (validation.lastProblems ?? detail.draftProblems) : problems
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
          setView('yaml')
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
            setView('yaml')
            return
          }
        }
        // 로그아웃·로그인·테넌트 전환이 저장 도중 끝났다면 이전 화면의 게시 요청을 새 토큰으로 보내지 않는다.
        assertWorkflowDraftGeneration(generation)
        const result = await workflowApi.publish(id, publishTime, action.enable)
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
        // 켜기 겹침 409 는 초안 충돌이 아니다 — 서버 메시지(겹친 다른 워크플로우 이름 포함)를 그대로 보인다.
        if (isConflictError(error) && action.type !== 'reload' && !isStartOverlapError(error)) {
          updateDraft(id, { edit: unsavedEdit, conflict: true }, generation)
          throw error
        }
        if (action.type === 'publish' && apiErrorStatus(error) === 422) {
          const response = apiErrorResponse(error) as { problems?: WorkflowProblem[] } | null
          if (response?.problems) {
            queryClient.setQueryData<WorkflowDetail>(workflowKeys.detail(id), (current) => current && ({
              ...current, draftProblems: response.problems ?? [],
            }))
            setView('yaml')
          }
        }
        setWorkError(extractApiError(error, '워크플로우 작업을 완료하지 못했습니다.'))
        throw error
      }
    },
  })

  // 사용 켜기·끄기 — 쓰기와 같은 키라 진행 중에는 다른 쓰기·스위치가 잠긴다. 실패하면 스위치는 서버 값(detail.enabled)에 그대로 둔다.
  const toggleEnabled = useMutation({
    mutationKey: workflowKeys.detail(id),
    mutationFn: async (next: boolean) => {
      if (isLoggingOut) throw new Error('로그아웃 중에는 워크플로우를 변경할 수 없습니다.')
      const generation = getWorkflowDraftGeneration()
      setWorkError(null)
      try {
        const updated = await workflowApi.update(id, { enabled: next })
        assertWorkflowDraftGeneration(generation)
        queryClient.setQueryData<WorkflowDetail>(workflowKeys.detail(id), (current) => current && { ...current, enabled: updated.enabled })
        void queryClient.invalidateQueries({ queryKey: workflowKeys.detail(id) })
        void queryClient.invalidateQueries({ queryKey: workflowKeys.list(projectId) })
      } catch (error) {
        if (generation !== getWorkflowDraftGeneration()) throw error
        setWorkError(extractApiError(error, '사용 여부를 바꾸지 못했습니다.'))
        throw error
      }
    },
  })

  // 전환 중에도 같은 정의로 돌아오면 쓰기 응답이 올 때까지 입력을 막는다.
  const busy = useIsMutating({ mutationKey: workflowKeys.detail(id), exact: true }) > 0
  const hasErrors = problems.some((problem) => problem.severity === 'ERROR')
  // 검증 요청에 실패하면 진단 목록이 비어 있어도 검증이 끝날 때까지 게시를 막는다.
  // 게시 안 한 변경이 0 이면 같은 원문으로 게시본 버전만 하나 더 쌓인다(WP-2043). 서버는 같은 내용 재게시를 허용하므로 화면이 막는다.
  // - 게시본이 있고 변경이 0 이면 사유 글자와 함께 막는다. 첫 게시(게시본 없음)는 비교할 게시본이 없어 0 이어도 막지 않는다.
  // - 게시본 원문을 불러오는 중(null)에는 변경 수를 모르므로 사유 글자 없이 잠시 막는다(상태 라벨이 확인 중을 알린다).
  // - 불러오기에 실패하면(isError) 개수를 영영 알 수 없으므로 막지 않는다.
  const noChanges = activeVersionNo !== null && unpostedChanges === 0
  const checkingChanges = activeVersionNo !== null && unpostedChanges === null && !published.isError
  const noChangesReasonId = useId()
  const canPublish = canManage && !isLoggingOut && !conflict && !busy && !validation.pending && !validation.failed && !hasErrors && !noChanges && !checkingChanges

  // YAML 편집기와 그래프 편집기가 같은 초안 갱신 규칙을 쓴다 — 기준 YAML 과 같아지면 편집을 지운다.
  function editDraft(updated: string) {
    const baseYaml = edit?.baseYaml ?? detail.draftYaml
    updateDraft(id, updated === baseYaml && !conflict ? null : {
      edit: { yaml: updated, expectedDraftUpdatedAt: expected, baseYaml },
      conflict,
    })
  }

  // 검사 배지의 「YAML 오류 확인」 — 배지가 사라지면 새로 열린 YAML 편집기로 포커스를 옮긴다.
  function openYamlDiagnostics() {
    if (view === 'yaml') { editor.current?.focus(); return }
    focusYamlOnOpen.current = true
    setView('yaml')
  }

  // 사용 스위치(WP-2119) — 시안대로 머리 오른쪽 묶음의 게시 단추 옆에 둔다(권한이 없으면 같은 자리에 읽기 전용 배지).
  // 끄기 확인의 실행 수는 수를 아직 모를 때(버전 목록을 받은 적 없음)만 null — 창을 연 채 다시 불러와도 「끄기」가 잠기지 않게.
  // 켜고 끄기는 초안과 따로라 초안 충돌 배너 중에도 잠그지 않는다(쓰기 진행 중 busy 만).
  const enableSwitch = (
    <WorkflowEnableSwitch
      enabled={detail.enabled}
      canManage={canManage && !isLoggingOut}
      hasPublishedVersion={activeVersionNo !== null}
      activeRuns={running}
      runsLoadError={versions.isError && !versions.isFetching}
      onRetryRuns={() => void versions.refetch()}
      busy={busy}
      onChange={(next) => toggleEnabled.mutate(next)}
    />
  )

  // 복원 뒤 다이얼로그가 이전 위치에 포커스를 돌려줘도 선택한 보기를 유지한다.
  return (
    <Tabs value={view} onValueChange={setView} activationMode="manual" className="min-h-0 flex-1 gap-0">
      {/* 머리 한 줄 — 선택·상태·보기 전환(왼쪽), 검사·저장·게시(오른쪽). 좁으면 줄바꿈 */}
      <WorkflowHeader>
        {picker}
        <span className={STATUS_PILL}>{activeVersionNo !== null ? `게시 버전 ${activeVersionNo}` : '게시 전'}</span>
        {canManage && draftChanged && <span className={STATUS_PILL}>초안 있음</span>}
        <TabsList aria-label="워크플로우 보기">
          <TabsTrigger value="graph">그래프</TabsTrigger>
          <TabsTrigger value="yaml">YAML</TabsTrigger>
          <TabsTrigger value="runs">{running === null ? '실행' : `실행 ${running}`}</TabsTrigger>
          <TabsTrigger value="versions">게시 이력</TabsTrigger>
        </TabsList>
        {canManage && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <WorkflowProblemsBadge
              problems={badgeProblems}
              checking={validation.pending}
              stale={badgeStale}
              announce={view !== 'yaml'}
              failed={validation.failed}
              readOnly={busy || isLoggingOut || conflict}
              onRetry={validation.retry}
              onAddAskPath={(nodeKey) => editDraft(addAskPath(yaml, nodeKey))}
              onOpenYaml={openYamlDiagnostics}
            />
            <span className="text-xs text-muted-foreground" role="status">
              {changeCountLabel}
            </span>
            <Button size="sm" variant="ghost" disabled={!edit || busy || conflict || isLoggingOut} onClick={() => updateDraft(id, null)}>되돌리기</Button>
            <Button size="sm" variant="outline" disabled={!edit || busy || conflict || isLoggingOut} onClick={() => write.mutate({ type: 'save' })}>초안 저장</Button>
            {/* 꺼진 단추는 pointer-events-none 이라 title 툴팁이 뜨지 않는다 — 이유를 단추 옆에 보이는 글자로 둔다. */}
            {noChanges && <span id={noChangesReasonId} className="text-xs text-muted-foreground">{NO_CHANGES_REASON}</span>}
            <Button
              size="sm"
              disabled={!canPublish}
              aria-describedby={noChanges ? noChangesReasonId : undefined}
              onClick={() => { setEnableOnPublish(true); setPublishConfirmation({ yaml, edit, expectedDraftUpdatedAt: expected }) }}
            >게시</Button>
            {enableSwitch}
          </div>
        )}
        {/* 읽기 전용 배지도 관리자 스위치와 같은 자리(머리 오른쪽 끝)에 둔다 */}
        {!canManage && <div className="ml-auto flex items-center">{enableSwitch}</div>}
      </WorkflowHeader>
      {(conflict || workError) && (
        <div className="space-y-2 px-4 pt-3">
          {conflict && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm">
              <p>다른 곳에서 초안이 바뀌었습니다. 최신 초안을 불러오면 현재 편집 내용이 바뀝니다.</p>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => write.mutate({ type: 'reload' })}>최신 초안 불러오기</Button>
            </div>
          )}
          {workError && <p role="alert" className="text-sm text-destructive">{workError}</p>}
        </div>
      )}
      {/* 탭 패널 제목 — 페이지 h1 다음 h3(검증 결과 등)로 건너뛰지 않게 패널마다 스크린리더용 h2 를 둔다(WP-2054, WCAG 1.3.1) */}
      <TabsContent value="graph" className={PANE}>
        <h2 className="sr-only">그래프</h2>
        {canManage ? (
          <WorkflowGraphEditor
            yaml={yaml}
            readOnly={busy || isLoggingOut}
            onChange={editDraft}
            onOpenYaml={openYamlDiagnostics}
          />
        ) : (
          <PublishedWorkflow mode="graph" published={published} hasVersion={activeVersionNo !== null} editor={editorRef} />
        )}
      </TabsContent>
      <TabsContent value="yaml" className={`${PANE} space-y-3`}>
        <h2 className="sr-only">YAML</h2>
        {canManage ? (
          <div className="@container">
            <div className="grid min-w-0 items-start gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(14rem,30%)]">
              <WorkflowYamlEditor
                yaml={yaml}
                textareaRef={editorRef}
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
        ) : (
          <PublishedWorkflow mode="yaml" published={published} hasVersion={activeVersionNo !== null} editor={editorRef} />
        )}
      </TabsContent>
      <TabsContent value="runs" className={`${PANE} space-y-3`}>
        <h2 className="sr-only">실행</h2>
        {/* 진행 중인 실행 수 문구는 목록 머리(WorkflowRuns)로 옮겼다. */}
        <WorkflowRuns workflowId={id} projectKey={project.key} activeVersionNo={activeVersionNo} canManage={canManage} canRecover={project.viewerIsMember} meId={user?.id ?? 0}
          runningCount={running} runningFailed={running === null && versions.isError} onRetryRunning={() => void versions.refetch()}
          olderNotice={olderNotice} />
      </TabsContent>
      <TabsContent value="versions" className={`${PANE} space-y-3`}>
        <h2 className="sr-only">게시 이력</h2>
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
          onPublish={() => {
            if (publishConfirmation) write.mutate({ type: 'publish', confirmation: publishConfirmation, enable: activeVersionNo === null ? enableOnPublish : undefined })
          }}
          firstPublish={activeVersionNo === null}
          enableOnPublish={enableOnPublish}
          onEnableOnPublishChange={setEnableOnPublish}
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
  if (mode === 'graph') return <div className="h-full overflow-auto rounded-md border"><WorkflowGraphView model={published.data.model} readOnly={true} /></div>
  return <WorkflowYamlEditor yaml={published.data.sourceYaml} textareaRef={editor} problems={NO_PROBLEMS} readOnly onChange={() => {}} />
}

/** 검증 결과 상태 — result 는 현재 편집의 결과, last 는 직전 성공 검증의 문제 */
type ValidationState = {
  result: { edit: DraftEdit; problems: WorkflowProblem[]; failed: boolean } | null
  last: WorkflowProblem[] | null
}
const NO_VALIDATION: ValidationState = { result: null, last: null }

/** 최근 입력만 지연 검증한다. 이전 요청은 취소하고 지난 진단은 입력 위에 남겨 두지 않는다. */
function useDraftValidation(projectId: number, edit: DraftEdit | null) {
  // 검증 결과(result)와 이 세션에서 마지막으로 성공한 결과(last — 실패·다시 확인으로 result 가 바뀌어도 지우지 않는다, 검사 중 배지용)를 한 상태로 둔다
  const [state, setState] = useState<ValidationState>(NO_VALIDATION)
  const [attempt, setAttempt] = useState(0)
  // 되돌리기로 편집이 없어지면 버린 편집의 결과도 함께 지운다 — 다시 편집할 때 검사 중 배지가 옛 결과를 보이지 않게(렌더 중 상태 보정, 갱신 한 번)
  if (!edit && state !== NO_VALIDATION) setState(NO_VALIDATION)
  const { result, last: lastProblems } = state
  useEffect(() => {
    if (!edit) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void workflowApi.validate(projectId, edit.yaml, controller.signal).then(
        ({ problems }) => { if (!controller.signal.aborted) { setState({ result: { edit, problems, failed: false }, last: problems }) } },
        () => { if (!controller.signal.aborted) setState((prev) => ({ ...prev, result: { edit, problems: NO_PROBLEMS, failed: true } })) },
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
    /** 직전 성공 검증의 문제(검증 중 배지용) — 없으면 null */
    lastProblems,
    pending: edit !== null && current === null,
    failed: current?.failed ?? false,
    retry: () => {
      setState((prev) => ({ ...prev, result: null }))
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
