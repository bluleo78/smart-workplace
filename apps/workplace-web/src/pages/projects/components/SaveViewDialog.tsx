// 뷰 저장/수정 다이얼로그 — 생성 시 현재 URL 쿼리스트링을, 수정 시 기존 뷰의 쿼리를 이름+가시성과 함께 저장.
// 열 구성은 생성 때 「현재 열 구성도 함께 저장」(기본 꺼짐)을 켰을 때만 담는다(WP-270 사용자 결정, 스펙 4.7).
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { useCreateSavedView, useUpdateSavedView } from '../../../hooks/queries/useSavedViews'
import { liveSearchParams } from '../../../lib/historyParam'
import type { IssueListColumnKey } from '../../../lib/issueListColumns'
import { savedViewUpdateQuery, syncSavedViewColumns } from '../../../lib/savedViewQuery'
import type { SavedViewResponse, Visibility } from '../../../types/savedView'
import { useColumnDefs } from './issueListColumnDefs'


/** 뷰 이름 최대 길이 — 서버 SavedView 요청 검증(@Size max=60)과 같다(WP-474). */
const SAVED_VIEW_NAME_MAX = 60

/** 저장 창의 열 안내 — 지금 고른 열을 목록 헤더 문구로 「(우선순위·담당자·마감·보고자)」. 커스텀 열은 필드 이름(정의가 오면). */
function ColumnsHint({ projectKey, columns }: { projectKey: string; columns: IssueListColumnKey[] }) {
  // 커스텀 열이 있을 때만 정의를 요청한다(useColumnDefs) — 목록이 같은 쿼리 키로 이미 불러 두었으면 캐시를 쓴다.
  const headers = useColumnDefs(projectKey, columns).defs.map((d) => d.header)
  return (
    <span data-testid="save-view-columns-hint" className="text-muted-foreground">
      ({headers.length > 0 ? headers.join('·') : '선택 열 없음'})
    </span>
  )
}

export function SaveViewDialog({
  projectKey,
  query,
  queryWithColumns,
  columns,
  editing,
  activeViewId,
  onCreated,
  open,
  onOpenChange,
}: {
  projectKey: string
  /** 현재 필터 쿼리스트링(? 제외, 열 cols 제외). 생성 모드에서는 그대로 저장되고, 수정 모드에서는
   *  "현재 필터로 갱신" 체크 시에만 editing.query 대신 이 값이 저장된다(#777). */
  query: string
  /** 현재 필터 + 지금 고른 열(cols). 생성 때 「현재 열 구성도 함께 저장」을 켜면 이 값을, 수정 때 열을 담은 뷰를 갱신하면 이 값을 저장한다. */
  queryWithColumns?: string
  /** 지금 고른 열(자동 완료일 열 제외) — 주면 생성 모드에 「현재 열 구성도 함께 저장」 체크박스를 보인다(열이 보이는 데스크톱 목록 보기만). */
  columns?: IssueListColumnKey[]
  /** 지정되면 수정 모드 — 기본은 이름/가시성만 변경하고 쿼리는 기존값 유지(체크박스로 갱신 가능). */
  editing?: SavedViewResponse
  /** 지금 활성인 뷰 id — 수정한 뷰가 이 뷰일 때만 갱신 뒤 URL 열을 맞춘다(다른 뷰를 고쳐도 지금 화면은 그대로). */
  activeViewId?: number | null
  /** 생성 성공 — 호출부가 막 만든 뷰를 활성으로 고른다(useSavedViewState.select). */
  onCreated?: (view: SavedViewResponse) => void
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const create = useCreateSavedView(projectKey)
  const update = useUpdateSavedView(projectKey)
  const [, setParams] = useSearchParams()
  // 저장한 뷰가 지금 화면이 됐을 때 URL cols 를 그 뷰에 맞춘다 — 「그 뷰를 연 상태」 와 같게(열을 담았으면 URL 로, 아니면 빼서 개인 열로).
  // 맞추지 않으면 열을 담은 뷰를 막 만든 화면에서 열을 바꿀 때 뷰(URL)가 아니라 개인 저장값이 바뀌었다.
  // 기준은 응답 시점의 지금 주소다(WP-955) — setParams 의 prev 는 저장을 누른 렌더의 URL 이라 그사이 바뀐 URL 을 되돌린다.
  const syncColumns = (savedQuery: string) =>
    setParams(syncSavedViewColumns(liveSearchParams(), savedQuery), { replace: true })
  const isEdit = !!editing
  // 수정 모드면 기존값으로 초기화 — 호출처에서 key 로 리마운트해 editing 별 초기값을 보장한다.
  const [name, setName] = useState(editing?.name ?? '')
  const [nameError, setNameError] = useState('')
  const [visibility, setVisibility] = useState<Visibility>(editing?.visibility ?? 'PRIVATE')
  // "현재 필터로 갱신" 체크박스(#777) — 수정 모드에서만 의미 있음. 기본 체크 해제:
  // 이름/가시성만 바꾸려는 흔한 경우가 실수로 필터까지 바뀌지 않도록.
  const [updateQuery, setUpdateQuery] = useState(false)
  // 「현재 열 구성도 함께 저장」 — 기본 꺼짐: 공유 뷰를 연 동료가 각자 개인 열로 보는 것이 기본(사용자 결정, 스펙 4.7).
  const [includeColumns, setIncludeColumns] = useState(false)
  const offerColumns = !isEdit && columns != null && queryWithColumns != null
  const pending = isEdit ? update.isPending : create.isPending
  // 생성 모드에서 필터 미적용(빈 query) 이면 백엔드 NotBlank 위반 → 클라이언트 가드.
  const noFilter = !isEdit && !query.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? '뷰 수정' : '뷰 저장'}</DialogTitle>
          <DialogDescription className="sr-only">{isEdit ? '뷰 수정' : '뷰 저장'}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            // 저장 — 이름 trim 후 빈 값이면 에러 메시지 표시. 성공 시 입력 초기화 + 닫기.
            e.preventDefault()
            const trimmed = name.trim()
            if (!trimmed) {
              setNameError('뷰 이름을 입력하세요')
              return
            }
            // 서버 상한(60자)과 같은 규칙 — 넘기면 서버 검증 원문(「크기가 0에서 60 사이여야 합니다」) 토스트만 떴다(WP-474).
            if (trimmed.length > SAVED_VIEW_NAME_MAX) {
              setNameError(`뷰 이름은 ${SAVED_VIEW_NAME_MAX}자 이하로 입력하세요`)
              return
            }
            if (noFilter) return
            try {
              if (isEdit) {
                // 수정: 기본은 쿼리를 기존값 유지, "현재 필터로 갱신" 체크 시에만 현재 URL
                // 쿼리로 교체한다(#777). 이전에는 무조건 editing.query 를 되돌려보내 체크박스
                // 없이는 필터 갱신이 불가능했다.
                // 갱신할 때 열은 뷰의 선택을 지킨다 — 열을 담은 뷰면 지금 열까지, 안 담은 뷰면 열 없이.
                const nextQuery = updateQuery ? savedViewUpdateQuery(editing.query, queryWithColumns ?? query) : editing.query
                await update.mutateAsync({ id: editing.id, body: { name: trimmed, query: nextQuery, visibility } })
                // 쿼리를 그대로 둔 수정(이름·가시성만)이나 활성 뷰가 아닌 뷰의 수정은 지금 화면과 무관하므로 URL 을 건드리지 않는다.
                if (updateQuery && editing.id === activeViewId) syncColumns(nextQuery)
              } else {
                const payload = offerColumns && includeColumns ? queryWithColumns : query
                const created = await create.mutateAsync({ name: trimmed, query: payload, visibility })
                // 지금 화면이 곧 새 뷰다 — 새 뷰를 고르고(WP-473) URL 열을 그 뷰에 맞춘다.
                onCreated?.(created)
                syncColumns(payload)
              }
              setName('')
              setNameError('')
              setVisibility('PRIVATE')
              setUpdateQuery(false)
              setIncludeColumns(false)
              onOpenChange(false)
            } catch {
              // 토스트는 훅 onError 에서 처리
            }
          }}
          className="space-y-4"
        >
          {/* 필터 미적용 안내 — 빈 query 로 저장 시도 방지 */}
          {noFilter && (
            <p data-testid="save-view-no-filter-msg" className="text-sm text-destructive">
              저장하려면 먼저 필터를 하나 이상 적용하세요.
            </p>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="save-view-name">
              뷰 이름
            </label>
            <Input
              id="save-view-name"
              data-testid="save-view-name"
              value={name}
              // 입력 단계에서 서버 상한까지만 받는다(WP-474). 예전에 저장된 긴 이름은 제출 시 위 검증이 안내한다.
              maxLength={SAVED_VIEW_NAME_MAX}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'save-view-name-error' : undefined}
              onChange={(e) => {
                setName(e.target.value)
                if (nameError) setNameError('')
              }}
              placeholder="예: 내 HIGH 이슈"
            />
            {/* 빈 이름 제출 시 표시되는 인라인 에러 메시지 */}
            {nameError && (
              <p id="save-view-name-error" data-testid="save-view-name-error" className="text-sm text-destructive">
                {nameError}
              </p>
            )}
          </div>
          <fieldset className="flex items-center gap-4 border-none p-0 text-sm">
            <legend className="mb-1 text-sm font-medium">가시성</legend>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'PRIVATE'}
                onChange={() => setVisibility('PRIVATE')}
              />
              개인
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="visibility"
                data-testid="save-view-shared"
                checked={visibility === 'SHARED'}
                onChange={() => setVisibility('SHARED')}
              />
              공유
            </label>
          </fieldset>
          {/* WP-270: 생성 모드·목록 보기에서만 — 켜면 지금 고른 열(cols)을 뷰에 담는다. 기본 꺼짐(각자 개인 열로 보기). */}
          {offerColumns && (
            <label className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <input
                type="checkbox"
                data-testid="save-view-include-columns"
                checked={includeColumns}
                onChange={(e) => setIncludeColumns(e.target.checked)}
              />
              현재 열 구성도 함께 저장
              <ColumnsHint projectKey={projectKey} columns={columns} />
            </label>
          )}
          {/* #777: 수정 모드에서만 노출 — 체크 시 현재 URL 필터로 뷰의 쿼리를 교체한다.
              기본 체크 해제(이름/가시성만 바꾸는 흔한 경우가 실수로 필터까지 바뀌지 않도록). */}
          {isEdit && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="save-view-update-query"
                checked={updateQuery}
                onChange={(e) => setUpdateQuery(e.target.checked)}
              />
              현재 필터로 갱신
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" data-testid="save-view-submit" disabled={pending || noFilter}>
              {pending ? (isEdit ? '수정 중…' : '저장 중…') : (isEdit ? '수정' : '저장')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
