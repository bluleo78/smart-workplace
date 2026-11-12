import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Folder, FolderOpen, FolderPlus } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useState } from 'react'

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/overlay/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter'
import { extractApiError } from '@/lib/api-error'
import { isImeComposing } from '@/lib/imeKey'

import { driveApi } from '../../api/drive'
import { driveKeys } from '../../hooks/queries/driveKeys'
import { useDriveItems } from '../../hooks/queries/useDriveItems'
import { type SaveTargetSpaces,spaceDisplayName } from '../../lib/driveSpaces'
import { cn } from '../../lib/utils'
import type { DriveSpace } from '../../types/drive'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { DriveThumbnail } from './DriveThumbnail'
import { FileTypeIcon } from './FileTypeIcon'
import { SpaceTypeIcon } from './SpaceTypeIcon'

/** 저장 모드(WP-1526) props — 저장할 파일, 고를 수 있는 공간 후보, 처음 열 폴더 경로. */
export interface FolderPickerSaveProps {
  fileName: string
  mimeType: string
  spaces: SaveTargetSpaces
  initialTrail?: { id: number; name: string }[]
}

interface Props {
  spaceId: number
  /** 이동·복사·파일 고르기 모드의 첫 경로 이름(지금 보는 공간 이름) — 호출부가 넘긴다. 없으면 「루트」. 저장 모드는 spaces 에서 찾으므로 무시한다. */
  rootLabel?: string
  title: string
  /** 선택 모드: 'folder'(기본) = 폴더 탐색 후 대상 확정, 'file' = 파일 클릭으로 즉시 선택 */
  mode?: 'folder' | 'file'
  /**
   * 「새 폴더」 버튼을 보일지(WP-1527) — 생략하면 저장 모드(save)만 true, 이동·복사는 false(쓰기 권한을 호출부가 알려야 켠다).
   * 보기 전용·보관된 공간처럼 만들 수 없는 곳은 호출부가 false 로 넘긴다. mode='file' 에서는 값과 상관없이 숨긴다.
   */
  canCreateFolder?: boolean
  // 비활성화할 폴더(이동 중인 폴더 자신) — 진입·선택 불가. 하위 폴더(서브트리) 차단은 백엔드(400)가 담당.
  disabledFolderId?: number
  /**
   * mode='folder' 일 때 확정 콜백 — spaceId 는 확정한 공간(저장 모드에서 창 안에서 바꿀 수 있다),
   * path 는 루트 → 대상 폴더까지의 폴더 이름(루트면 빈 배열). 저장 위치 안내에 쓴다(WP-1525).
   */
  onConfirm?: (targetId: number | null, spaceId: number, path: string[]) => void
  /**
   * 저장 모드(WP-1526) — 파일을 드라이브에 새로 저장할 위치를 고른다. spaces 는 호출부가 saveTargetSpaces 로 걸러 개인·팀으로 나눠 넘긴다.
   * spaceId 는 처음 공간이고 창 안에서 바꾼 공간은 내부 상태 — 확정 때 onConfirm 두 번째 인자로 알린다.
   * 저장 모드의 spaceId 는 초기값일 뿐 — 이후 prop 변경은 무시하므로 호출부는 창을 마운트/언마운트해 초기화한다.
   */
  save?: FolderPickerSaveProps
  /** mode='file' 일 때 파일 선택 콜백 */
  onPickFile?: (driveFileId: number, name: string) => void
  onClose: () => void
}

/**
 * 저장 모드 경로 막대의 공간 선택 — 아이콘 + 공간 이름 단계(rootLabel) + ▾ 묶음. 후보가 둘 이상일 때만 ▾ 를 보인다.
 * 값 글자는 옆 공간 이름 단추가 대신하므로 트리거는 ▾ 만 보이고 스크린리더에는 현재 공간 이름을 읽어 준다.
 */
function SaveSpaceSelect({
  spaces,
  activeSpace,
  activeSpaceId,
  rootLabel,
  onChange,
}: {
  spaces: SaveTargetSpaces
  activeSpace: DriveSpace | undefined
  activeSpaceId: number
  rootLabel: ReactNode
  onChange: (value: string) => void
}) {
  return (
    <span className="flex min-w-0 items-stretch overflow-hidden rounded-md border">
      <span className="flex min-w-0 items-center gap-1.5 px-2 py-1">
        <SpaceTypeIcon type={activeSpace?.type} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {rootLabel}
      </span>
      {spaces.all.length > 1 && (
        <Select value={String(activeSpaceId)} onValueChange={onChange}>
          <SelectTrigger
            className="h-auto w-auto rounded-none border-0 border-l px-1.5 py-1 shadow-none data-[size=default]:h-auto"
            aria-label="저장할 공간"
            data-testid="folder-picker-space-select"
          >
            {/* 공간 이름은 왼쪽에 이미 보이므로 ▾ 안의 값은 화면 읽기 프로그램에만 읽힌다.
                SelectValue 에 직접 sr-only 를 주면 트리거의 *:data-[slot=select-value]:flex 가 덮어 보이게 되어 span 으로 감싼다. */}
            <span className="sr-only">
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent position="popper">
            {([['개인', spaces.personal], ['팀 스페이스', spaces.team]] as const).map(
              ([label, group]) =>
                group.length > 0 && (
                  <SelectGroup key={label}>
                    <SelectLabel>{label}</SelectLabel>
                    {group.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        <SpaceTypeIcon type={s.type} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {spaceDisplayName(s)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ),
            )}
          </SelectContent>
        </Select>
      )}
    </span>
  )
}

/** 저장 모드 푸터의 저장될 위치 요약 — 「공간 › 폴더 › …」. */
function SaveLocationSummary({ names }: { names: string[] }) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-testid="folder-picker-location">
      <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{names.join(' › ')}</span>
    </p>
  )
}

/**
 * 같은 공간의 폴더 트리를 탐색해 이동/복사 대상 폴더(또는 루트)를 고르는 모달.
 * mode='file' 시 파일 행도 렌더하고 클릭 시 onPickFile 호출 (footer 확정 버튼 숨김).
 * shadcn Dialog로 래핑하여 Esc 닫기·오버레이 클릭 닫기·포커스 트랩을 Radix가 자동 처리.
 */
export function FolderPickerModal({
  spaceId,
  rootLabel: rootLabelProp,
  title,
  mode = 'folder',
  canCreateFolder,
  disabledFolderId,
  onConfirm,
  onPickFile,
  save,
  onClose,
}: Props) {
  // 저장 모드만 창 안에서 공간을 바꾸므로 내부 상태(처음 값은 spaceId) — 다른 모드는 spaceId prop 을 그대로 따른다(파생값).
  const [savedSpaceId, setSavedSpaceId] = useState(spaceId)
  const activeSpaceId = save ? savedSpaceId : spaceId
  // 루트부터 지금 폴더까지 들어온 경로(이름 포함) — 경로 표시와 중간 단계로 돌아가기에 쓴다(WP-530).
  // 저장 모드는 마지막에 저장한 폴더 안에서 열 수 있게 initialTrail 로 시작한다.
  const [trail, setTrail] = useState<{ id: number; name: string }[]>(save?.initialTrail ?? [])
  const current = trail.at(-1)?.id ?? null
  // WP-63: 현재 탐색 폴더의 내용 — DrivePage 와 같은 ['drive','items',spaceId,folderId] 키로 캐시를 공유해
  // resource.changed 무효화 시 함께 갱신된다. 폴더·파일은 응답에서 그대로 분리해 쓴다(미로드 시 빈 목록).
  const { data, isLoading, isError } = useDriveItems(activeSpaceId, current ?? undefined)
  const folders = data?.folders ?? []
  const files = data?.files ?? []
  const queryClient = useQueryClient()
  // 새 폴더 입력 줄 상태(WP-1527) — draft 가 null 이면 닫힘, 아니면 열려 있고 이름·서버 오류를 든다. newBusy 는 요청 중.
  const [draft, setDraft] = useState<{ name: string; error: string | null } | null>(null)
  const [newBusy, setNewBusy] = useState(false)
  const { handleEnter, onCompositionEnd } = useSingleLineEnter()
  // 폴더 고르기 모드에서만, 호출부가 막지 않았을 때만 만들 수 있다.
  const canCreate = mode === 'folder' && (canCreateFolder ?? Boolean(save))

  /** 입력 줄을 닫고 비운다 — Esc·위치가 바뀔 때. */
  const closeNew = () => setDraft(null)
  // 저장 모드에서만: 기억한 폴더가 지워졌거나 못 읽으면(조회 오류) 루트로 돌아간다 — 렌더 중 state 조정.
  // 이동·복사·파일 고르기는 예전처럼 오류여도 경로를 유지한다.
  if (save && isError && trail.length > 0) {
    closeNew()
    setTrail([])
  }

  // 공간 이름: 저장 모드는 넘겨받은 후보에서, 이동·복사·파일 고르기는 호출부가 넘긴 rootLabel(없으면 예전과 같은 「루트」).
  const activeSpace = save?.spaces.all.find((s) => s.id === activeSpaceId)
  const spaceName = save ? (activeSpace ? spaceDisplayName(activeSpace) : '루트') : (rootLabelProp ?? '루트')

  /**
   * 사용자가 경로를 바꾼다 — 열린 입력 줄은 이전 위치 기준이라 함께 닫는다. 사용자 이동은 모두 이 함수를 지난다(성공 이동은 submitNew 가 직접).
   * 만들기 요청 중에는 무시한다 — 끝났을 때 옛 경로에 새 폴더를 붙이거나 닫힌 입력 줄에 오류가 남는 것을 막는다.
   */
  const go = (next: { id: number; name: string }[]) => {
    if (newBusy) return
    closeNew()
    setTrail(next)
  }

  /** 지금 위치에 폴더를 만들고 그 안으로 들어간다. 서버 오류(같은 이름 등)는 입력 줄 아래에 보이고 입력은 남긴다. */
  const submitNew = async () => {
    // 요청 중 중복은 요청하지 않는다(newBusy 로 Enter 연타 방지).
    if (newBusy || !draft) return
    const name = draft.name.trim()
    // 빈 이름은 요청하지 않고 DrivePage 새 폴더 대화상자와 같은 문구로 알린다.
    if (!name) {
      setDraft({ ...draft, error: '폴더 이름을 입력해주세요.' })
      return
    }
    setNewBusy(true)
    try {
      const { data: folder } = await driveApi.createFolder(activeSpaceId, current, name)
      void queryClient.invalidateQueries({ queryKey: driveKeys.itemsAll(activeSpaceId) })
      // newBusy 가 아직 true 라 go 가 막으므로 직접 닫고 이동한다.
      closeNew()
      setTrail([...trail, { id: folder.id, name: folder.name }])
    } catch (e) {
      setDraft({ name, error: extractApiError(e, '폴더를 만들지 못했습니다.') })
    } finally {
      setNewBusy(false)
    }
  }
  /** Enter 로 만든다 — 한글 조합 Enter·macOS Chrome 꼬리 Enter 는 공용 훅이 걸러 반쪽 이름이 만들어지지 않게 한다. */
  const onNewKey = (e: KeyboardEvent<HTMLInputElement>) => handleEnter(e, () => void submitNew())

  /** 공간을 바꾸면 경로를 비운다 — 새 공간 루트에서 시작. */
  const changeSpace = (value: string) => {
    // go 의 요청 중 가드보다 먼저 공간 state 를 바꾸므로 여기서도 막는다(아니면 요청 중에 공간만 바뀐다).
    if (newBusy) return
    setSavedSpaceId(Number(value))
    go([])
  }

  /** 경로 첫 단계(공간 이름) — 저장 모드는 아이콘+이름+▾ 묶음, 이동/복사는 글자만. 지금 위치가 아니면 눌러 루트로 돌아간다. */
  const rootLabel =
    trail.length > 0 ? (
      <button
        type="button"
        onClick={() => go([])}
        className="truncate text-primary hover:underline"
        data-testid="folder-picker-space-root"
      >
        {spaceName}
      </button>
    ) : (
      <span aria-current="location" className="truncate font-medium" data-testid="folder-picker-space-root">
        {spaceName}
      </span>
    )

  return (
    // open 고정 true — 부모가 마운트/언마운트로 열기·닫기 제어함
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className={save ? 'sm:max-w-md' : 'w-80'}
        data-testid="folder-picker"
        // 입력 줄이 열려 있으면 Esc 는 창을 닫지 않는다.
        // 요청 중·IME 조합 중(조합 취소용)이면 입력 줄도 두고, 그 밖에는 입력 줄만 닫는다.
        onEscapeKeyDown={(e) => {
          if (!draft) return
          e.preventDefault()
          if (!newBusy && !isImeComposing(e)) closeNew()
        }}
      >
        <DialogHeader>
          <DialogTitle className={cn('font-semibold', save ? 'text-base' : 'text-sm')}>{title}</DialogTitle>
          {save ? (
            // 저장할 파일 — 스크린리더용 설명을 겸한다.
            <DialogDescription className="flex min-w-0 items-center gap-2" data-testid="folder-picker-file">
              <FileTypeIcon mimeType={save.mimeType} />
              <span className="truncate">{save.fileName}</span>
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        {/* 경로 막대 + 「새 폴더」 — 버튼은 같은 줄 오른쪽 끝(WP-1527) */}
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <nav aria-label="폴더 경로" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs" data-testid="folder-picker-path">
            {save ? (
              <SaveSpaceSelect
                spaces={save.spaces}
                activeSpace={activeSpace}
                activeSpaceId={activeSpaceId}
                rootLabel={rootLabel}
                onChange={changeSpace}
              />
            ) : (
              rootLabel
            )}
            {trail.map((step, i) => (
              <span key={step.id} className="flex min-w-0 items-center gap-1">
                {save ? (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <span className="text-muted-foreground" aria-hidden>/</span>
                )}
                {i < trail.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => go(trail.slice(0, i + 1))}
                    className="max-w-40 truncate text-primary hover:underline"
                    title={step.name}
                  >
                    {step.name}
                  </button>
                ) : (
                  <span aria-current="location" className="max-w-40 truncate font-medium" title={step.name}>
                    {step.name}
                  </span>
                )}
              </span>
            ))}
          </nav>
          {canCreate && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                // 열 때마다 빈 입력·오류 없음으로 시작한다.
                setDraft({ name: '', error: null })
              }}
              disabled={draft !== null}
              className="shrink-0 text-muted-foreground"
              data-testid="folder-picker-new"
            >
              <FolderPlus aria-hidden />
              새 폴더
            </Button>
          )}
        </div>
        <ul className={cn('mb-3 max-h-60 divide-y divide-border overflow-auto', save && 'min-h-52 rounded-md border px-2')}>
          {draft && (
            <li className="py-1.5">
              <div className="flex items-center gap-2">
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <Input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ name: e.target.value, error: null })}
                  onKeyDown={onNewKey}
                  onCompositionEnd={onCompositionEnd}
                  placeholder="새 폴더 이름"
                  aria-label="새 폴더 이름"
                  aria-invalid={draft.error ? true : undefined}
                  readOnly={newBusy}
                  aria-busy={newBusy || undefined}
                  className="h-8 text-sm"
                  data-testid="folder-picker-new-input"
                />
              </div>
              {draft.error && (
                <p role="alert" className="mt-1 pl-6 text-xs text-destructive" data-testid="folder-picker-new-error">
                  {draft.error}
                </p>
              )}
            </li>
          )}
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                disabled={f.id === disabledFolderId}
                onClick={() => go([...trail, { id: f.id, name: f.name }])}
                className="flex w-full items-center gap-2 py-1.5 text-left text-sm hover:underline disabled:opacity-40"
              >
                {/* 폴더 아이콘 — lucide Folder SVG, DrivePage와 일관성 유지 */}
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {save && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
              </button>
            </li>
          ))}
          {/* file 모드: 파일 행도 렌더. 클릭 시 onPickFile 즉시 호출 */}
          {mode === 'file' &&
            files.map((f) => (
              <li key={`file-${f.id}`}>
                <button
                  type="button"
                  onClick={() => onPickFile?.(f.id, f.name)}
                  className="flex w-full items-center gap-2 py-1.5 text-left text-sm hover:bg-accent/50"
                  data-testid={`file-picker-file-${f.id}`}
                >
                  <DriveThumbnail fileId={f.fileId} category={f.category} mimeType={f.mimeType} name={f.name} />
                  <span className="truncate">{f.name}</span>
                </button>
              </li>
            ))}
          {/* WP-63: 첫 조회 중엔 빈 목록 문구를 숨긴다 — 폴더 이동 직후 거짓 "없음" 깜빡임 방지 */}
          {!isLoading && !draft && (mode === 'folder' ? folders.length === 0 : files.length === 0) && (
            <li
              className={cn(
                'text-center text-xs text-muted-foreground',
                save ? 'flex min-h-52 flex-col items-center justify-center gap-1 py-6' : 'py-4',
              )}
            >
              {mode === 'file' ? (
                '파일 없음'
              ) : save ? (
                <>
                  <FolderOpen className="h-5 w-5" aria-hidden />
                  폴더 없음
                </>
              ) : (
                '하위 폴더 없음'
              )}
            </li>
          )}
        </ul>
        <DialogFooter className={cn(save && 'flex-col items-stretch sm:flex-row sm:items-center sm:justify-between')}>
          {save && <SaveLocationSummary names={[spaceName, ...trail.map((t) => t.name)]} />}
          <div className={cn('flex gap-2', save && 'w-full sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none')}>
            <button type="button" onClick={onClose} className="rounded border px-2 py-1 text-sm">
              취소
            </button>
            {/* folder 모드에서만 확정 버튼 표시 */}
            {mode === 'folder' && (
              <button
                type="button"
                disabled={current === disabledFolderId || newBusy}
                onClick={() => onConfirm?.(current, activeSpaceId, trail.map((s) => s.name))}
                className="rounded bg-primary px-2 py-1 text-sm text-primary-foreground disabled:opacity-40"
                data-testid="folder-picker-confirm"
              >
                {save ? '여기에 저장' : '여기로'}
              </button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
