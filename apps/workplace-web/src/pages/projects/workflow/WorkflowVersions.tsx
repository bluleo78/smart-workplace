import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { formatDateTimeLocale } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { useWorkflowVersion, type useWorkflowVersions, type WorkflowModel, type WorkflowVersionDetail, type WorkflowVersionSummary } from '@/lib/workflows'

import { compareWorkflowYaml } from './workflowYamlDiff'

export const workflowSelectClass = 'h-8 max-w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-ring'

/** 단일 게시 버전은 바꿀 수 없으므로 기준과 비교 대상을 언제든 바꿔 볼 수 있다. */
export function WorkflowVersions({
  id, versions, canManage, busy, expectedDraftUpdatedAt, onRestore,
}: {
  id: number
  versions: ReturnType<typeof useWorkflowVersions>
  canManage: boolean
  busy: boolean
  expectedDraftUpdatedAt: string
  onRestore: (versionNo: number, expectedDraftUpdatedAt: string) => void
}) {
  const [fromNo, setFromNo] = useState<number | null>(null)
  const [toNo, setToNo] = useState<number | null>(null)
  // 확인 창을 연 뒤 초안 조회가 새로 끝나도 복원 기준 시각은 처음 본 값이다.
  const [restore, setRestore] = useState<{ versionNo: number; expectedDraftUpdatedAt: string } | null>(null)
  const compare = fromNo !== null && toNo !== null && fromNo !== toNo
  const from = useWorkflowVersion(id, compare ? fromNo : null)
  const to = useWorkflowVersion(id, compare ? toNo : null)

  if (versions.isPending) return <p className="text-sm text-muted-foreground">버전 목록을 불러오는 중…</p>
  if (!versions.data) return (
    <p role="alert" className="text-sm">
      버전 목록을 불러오지 못했습니다. <Button variant="link" size="sm" onClick={() => void versions.refetch()}>다시 불러오기</Button>
    </p>
  )
  if (versions.data.length === 0) return <p className="text-sm text-muted-foreground">게시한 버전이 없습니다.</p>

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full whitespace-nowrap text-start text-sm">
          <thead className="border-b bg-muted/50 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">버전</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">게시 시각</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">진행 중</th>
              {canManage && <th scope="col" className="px-3 py-2"><span className="sr-only">작업</span></th>}
            </tr>
          </thead>
          <tbody>
            {versions.data.map((version) => (
              <tr key={version.versionNo} className="border-b last:border-b-0">
                <th scope="row" className="px-3 py-2 text-start font-medium">버전 {version.versionNo}</th>
                <td className="px-3 py-2"><time dateTime={version.createdAt}>{formatDateTimeLocale(version.createdAt)}</time></td>
                <td className="px-3 py-2 tabular-nums">실행 {version.activeRuns}개</td>
                {canManage && (
                  <td className="px-3 py-2 text-end">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setRestore({ versionNo: version.versionNo, expectedDraftUpdatedAt })}>초안으로 복원</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {versions.data.length > 1 && (
        <div className="flex flex-wrap gap-3">
          <VersionSelect label="기준 버전" versions={versions.data} value={fromNo} onChange={setFromNo} />
          <VersionSelect label="비교 버전" versions={versions.data} value={toNo} onChange={setToNo} />
        </div>
      )}
      {fromNo !== null && fromNo === toNo && <p className="text-sm text-muted-foreground">서로 다른 두 버전을 선택하세요.</p>}
      {compare && (
        <>
          {(from.isError || to.isError) && (
            <p role="alert" className="text-sm">
              비교할 버전을 불러오지 못했습니다.{' '}
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  if (from.isError) void from.refetch()
                  if (to.isError) void to.refetch()
                }}
              >
                다시 불러오기
              </Button>
            </p>
          )}
          {(from.isPending || to.isPending) && <p className="text-sm text-muted-foreground">비교할 버전을 불러오는 중…</p>}
          {from.data && to.data && <VersionDiff from={from.data} to={to.data} />}
        </>
      )}
      {canManage && (
        <Dialog open={restore !== null} onOpenChange={(open) => { if (!open) setRestore(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>버전 {restore?.versionNo} 복원</DialogTitle>
              <DialogDescription>현재 초안과 편집 내용을 버전 {restore?.versionNo}의 YAML로 바꿉니다. 게시 버전은 그대로 유지됩니다.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRestore(null)}>취소</Button>
              <Button disabled={busy} onClick={() => {
                if (!restore) return
                onRestore(restore.versionNo, restore.expectedDraftUpdatedAt)
                setRestore(null)
              }}>초안으로 복원</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

/** 선택값이 없는 상태를 유지해 비교할 두 버전을 명시적으로 고른다. */
function VersionSelect({ label, versions, value, onChange }: {
  label: string
  versions: WorkflowVersionSummary[]
  value: number | null
  onChange: (value: number | null) => void
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <select className={workflowSelectClass} value={value ?? ''} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
        <option value="">선택</option>
        {versions.map(({ versionNo }) => <option key={versionNo} value={versionNo}>버전 {versionNo}</option>)}
      </select>
    </label>
  )
}

/** 시작 규칙은 서버 모델에서 노드 밖에 저장되므로 시작 노드와 함께 비교한다. */
function nodeSignatures(model: WorkflowModel) {
  return new Map(model.nodes.map((node) => [
    node.key, JSON.stringify(node.type === 'start' ? [node, model.start] : node),
  ]))
}

/** 원문은 행 단위로 비교하고, 구조의 변경은 서버가 정규화한 모델로 비교한다. */
function VersionDiff({ from, to }: { from: WorkflowVersionDetail; to: WorkflowVersionDetail }) {
  const { nodes, edits } = useMemo(() => {
    const before = nodeSignatures(from.model)
    const after = nodeSignatures(to.model)
    const nodes = [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key))

    const edits = compareWorkflowYaml(from.sourceYaml, to.sourceYaml).flatMap(([operation, text]) =>
      (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((line) => ({ operation, line: line.replace(/\n$/, '') })),
    )
    return { nodes, edits }
  }, [from, to])

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">변경된 노드</h3>
      {nodes.length > 0 ? (
        <ul aria-label="변경된 노드" className="flex flex-wrap gap-2 text-sm">
          {nodes.map((key) => <li key={key} className="rounded border bg-muted px-2 py-0.5 font-mono break-all">{key}</li>)}
        </ul>
      ) : <p className="text-sm text-muted-foreground">변경된 노드가 없습니다.</p>}
      <h3 className="pt-2 text-sm font-medium">YAML 변경 사항</h3>
      {from.sourceYaml === to.sourceYaml ? <p className="text-sm text-muted-foreground">YAML이 같습니다.</p> : (
        <pre className="max-h-96 overflow-auto rounded-md border bg-card py-2 text-sm">
          {edits.map(({ operation, line }, index) => (
            <code key={index} className={cn(
              'block min-w-max px-3',
              operation === -1 && 'bg-destructive-subtle text-destructive-text',
              operation === 1 && 'bg-success-subtle text-success-text',
            )}>
              {operation === -1 ? '- ' : operation === 1 ? '+ ' : '  '}{line}
            </code>
          ))}
        </pre>
      )}
    </section>
  )
}
