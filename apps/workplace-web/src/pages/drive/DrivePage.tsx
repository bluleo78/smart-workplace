import { Folder } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { handleApiError } from '@/lib/api-error'

import { driveApi } from '../../api/drive'
import { DriveThumbnail } from '../../components/drive/DriveThumbnail'
import { FilePreviewModal } from '../../components/drive/FilePreviewModal'
import { FolderPickerModal } from '../../components/drive/FolderPickerModal'
import { SearchInput } from '../../components/ui/search-input'
import type { DriveFile, DriveFolderPathSegment, DriveItemList, DriveSearchResult, DriveTrashItem } from '../../types/drive'

// 서버 multipart 업로드 한도(application.yml: max-file-size 25MB)와 동일. 초과 시 업로드 전 안내.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

// breadcrumb 접기 — 4개 초과면 [첫, null(…), 마지막2개]. null 은 생략 표식.
function collapseCrumbs(
  crumbs: DriveFolderPathSegment[],
): (DriveFolderPathSegment | null)[] {
  if (crumbs.length <= 4) return crumbs
  return [crumbs[0], null, crumbs[crumbs.length - 2], crumbs[crumbs.length - 1]]
}

/** 폴더 브라우저 — 검색 + 브레드크럼 + 폴더·파일 목록 + 업로드/새폴더/이름변경/삭제/미리보기/다운로드. */
export function DrivePage() {
  const { spaceId } = useParams()
  const sid = Number(spaceId)
  const [searchParams, setSearchParams] = useSearchParams()
  const folderParam = searchParams.get('folderId')
  const folderId = folderParam == null ? null : Number(folderParam)

  const [items, setItems] = useState<DriveItemList>({ folders: [], files: [] })
  const fileInput = useRef<HTMLInputElement>(null)
  const [picker, setPicker] = useState<
    { mode: 'move' | 'copy'; kind: 'file' | 'folder'; id: number; name: string } | null
  >(null)
  const [preview, setPreview] = useState<DriveFile | null>(null)

  // 검색 상태 — query 길이 ≥2 면 results 로 목록을 대체.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DriveSearchResult | null>(null)

  // 휴지통 뷰 — trash != null 이면 휴지통 모드.
  const [trash, setTrash] = useState<DriveTrashItem[] | null>(null)

  // 폴더 이름 입력 다이얼로그 — 새 폴더 생성(create) / 이름 변경(rename). window.prompt 대체 (#135).
  const [nameDialog, setNameDialog] = useState<{
    mode: 'create' | 'rename'
    folderId?: number
  } | null>(null)
  const [nameInput, setNameInput] = useState('')

  // 파일 업로드 진행 상태 — 업로드 중 버튼 비활성화·텍스트 변경으로 중복 업로드 방지 (#170).
  const [uploading, setUploading] = useState(false)

  // 파괴적 작업 확인 AlertDialog — 삭제/영구삭제/휴지통 비우기. window.confirm 대체 (#135).
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    description: string
    actionLabel: string
    action: () => Promise<void>
  } | null>(null)

  // breadcrumb 경로(루트→현재 폴더). folderId 가 있을 때 서버에서 폴더명 경로를 로드.
  const [crumbs, setCrumbs] = useState<DriveFolderPathSegment[]>([])

  async function reload() {
    const { data } = await driveApi.listItems(sid, folderId)
    setItems(data)
  }
  useEffect(() => {
    if (!Number.isNaN(sid)) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, folderId])

  // 폴더 진입 시 조상 경로(폴더명) 로드. 루트(null)면 비움. 실패 시 빈 경로로 폴백.
  useEffect(() => {
    if (folderId == null) {
      setCrumbs([])
      return
    }
    let alive = true
    void driveApi
      .getFolderPath(folderId)
      .then(({ data }) => {
        if (alive) setCrumbs(data)
      })
      .catch(() => {
        if (alive) setCrumbs([])
      })
    return () => {
      alive = false
    }
  }, [folderId])

  // 검색 디바운스(300ms). 2자 미만이면 결과 해제(브라우즈 복귀).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      return
    }
    const t = setTimeout(() => {
      void driveApi.search(sid, q).then(({ data }) => setResults(data))
    }, 300)
    return () => clearTimeout(t)
  }, [query, sid])

  function openFolder(id: number) {
    setQuery('')
    setResults(null)
    setSearchParams({ folderId: String(id) })
  }
  function goRoot() {
    setSearchParams({})
  }

  // 폴더 이름 다이얼로그 확인 — 생성/이름변경 API 호출 후 목록 갱신.
  // trim 없이 raw 값을 전송 — 공백만 입력 시 서버 @NotBlank 400 → 토스트 안내(#116 동작 보존).
  async function submitNameDialog() {
    if (!nameDialog || !nameInput) return
    const dialog = nameDialog
    setNameDialog(null)
    setNameInput('')
    try {
      if (dialog.mode === 'create') {
        await driveApi.createFolder(sid, folderId, nameInput)
        await reload()
      } else if (dialog.folderId != null) {
        await driveApi.renameFolder(dialog.folderId, nameInput)
        await reload()
      }
    } catch (e) {
      handleApiError(e, dialog.mode === 'create' ? '폴더를 만들지 못했습니다.' : '폴더 이름을 변경하지 못했습니다.')
    }
  }

  function onNewFolder() {
    setNameInput('')
    setNameDialog({ mode: 'create' })
  }
  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // 한도 초과는 업로드 전 클라이언트에서 안내 — 불필요한 400 왕복·데이터 유실 오인 방지.
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('파일 크기가 25MB를 초과합니다.')
      e.target.value = ''
      return
    }
    // 업로드 시작 — 버튼 비활성화로 중복 업로드 방지 (#170).
    setUploading(true)
    try {
      await driveApi.uploadFile(sid, folderId, file)
      e.target.value = ''
      await reload()
    } catch (err) {
      e.target.value = ''
      handleApiError(err, '파일을 업로드하지 못했습니다.')
    } finally {
      setUploading(false)
    }
  }
  function onRenameFolder(id: number, current: string) {
    setNameInput(current)
    setNameDialog({ mode: 'rename', folderId: id })
  }
  function onDeleteFolder(id: number) {
    setConfirmDialog({
      title: '폴더 삭제',
      description: '폴더를 휴지통으로 보낼까요? 30일 후 자동 삭제됩니다.',
      actionLabel: '삭제',
      action: async () => {
        try {
          await driveApi.deleteFolder(id)
          await reload()
        } catch (e) {
          handleApiError(e, '폴더를 삭제하지 못했습니다.')
        }
      },
    })
  }
  function onDeleteFile(id: number) {
    setConfirmDialog({
      title: '파일 삭제',
      description: '파일을 휴지통으로 보낼까요? 30일 후 자동 삭제됩니다.',
      actionLabel: '삭제',
      action: async () => {
        try {
          await driveApi.deleteFile(id)
          await reload()
        } catch (e) {
          handleApiError(e, '파일을 삭제하지 못했습니다.')
        }
      },
    })
  }

  async function onPickTarget(targetId: number | null) {
    if (!picker) return
    const { mode, kind, id } = picker
    try {
      if (kind === 'file') {
        if (mode === 'move') await driveApi.moveFile(id, targetId)
        else await driveApi.copyFile(id, targetId)
      } else {
        if (mode === 'move') await driveApi.moveFolder(id, targetId)
        else await driveApi.copyFolder(id, targetId)
      }
    } catch (e) {
      // 표준 토스트로 통일(기존 window.alert 대체) — 다른 mutation 과 피드백 일관성 확보.
      handleApiError(e, '이동/복사할 수 없는 위치입니다.')
    } finally {
      setPicker(null)
      await reload()
    }
  }

  async function openTrash() {
    setQuery('')
    setResults(null)
    const { data } = await driveApi.listTrash(sid)
    setTrash(data.items)
  }
  async function reloadTrash() {
    const { data } = await driveApi.listTrash(sid)
    setTrash(data.items)
  }
  function closeTrash() {
    setTrash(null)
    void reload()
  }
  // 복원 실패 시 사용자에게 오류 피드백 제공 (try/catch 추가)
  async function onRestore(it: DriveTrashItem) {
    try {
      if (it.type === 'FOLDER') await driveApi.restoreFolder(it.id)
      else await driveApi.restoreFile(it.id)
      await reloadTrash()
    } catch (e) {
      handleApiError(e, '복원하지 못했습니다.')
    }
  }
  function onPurge(it: DriveTrashItem) {
    setConfirmDialog({
      title: '영구 삭제',
      description: `'${it.name}' 을(를) 영구 삭제할까요? 되돌릴 수 없습니다.`,
      actionLabel: '영구삭제',
      action: async () => {
        try {
          if (it.type === 'FOLDER') await driveApi.purgeFolder(it.id)
          else await driveApi.purgeFile(it.id)
          await reloadTrash()
        } catch (e) {
          handleApiError(e, '영구 삭제하지 못했습니다.')
        }
      },
    })
  }
  function onEmptyTrash() {
    setConfirmDialog({
      title: '휴지통 비우기',
      description: '모든 항목이 영구 삭제됩니다. 되돌릴 수 없습니다.',
      actionLabel: '비우기',
      action: async () => {
        try {
          await driveApi.emptyTrash(sid)
          await reloadTrash()
        } catch (e) {
          handleApiError(e, '휴지통을 비우지 못했습니다.')
        }
      },
    })
  }

  const searching = results != null

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="drive-page">
      <PageHeader
        title="드라이브"
        actions={
          <>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="이 공간에서 검색..."
              aria-label="드라이브 검색"
            />
            <button
              type="button"
              onClick={onNewFolder}
              data-testid="drive-new-folder"
              className="rounded border px-2 py-1 text-sm hover:bg-accent/50"
            >
              새 폴더
            </button>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              data-testid="drive-upload"
              disabled={uploading}
              className="rounded bg-primary px-2 py-1 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? '업로드 중…' : '업로드'}
            </button>
            <input ref={fileInput} type="file" hidden onChange={onUpload} data-testid="file-input" />
            <button
              type="button"
              onClick={trash != null ? closeTrash : openTrash}
              className="rounded border px-2 py-1 text-sm hover:bg-accent/50"
              data-testid="trash-toggle"
            >
              {trash != null ? '← 드라이브' : '휴지통'}
            </button>
          </>
        }
      />
      {/* breadcrumb 행 — 브라우즈 모드(검색·휴지통 아님)에서만. 폴더명 경로, 깊으면 … 접기. */}
      {trash == null && !searching && (
        <nav
          aria-label="폴더 경로"
          className="flex h-9 shrink-0 items-center gap-1 border-b px-4 text-sm"
          data-testid="drive-breadcrumb"
        >
          <button
            type="button"
            onClick={goRoot}
            data-testid="drive-root"
            className={folderId == null ? 'font-semibold' : 'text-primary hover:underline'}
          >
            드라이브
          </button>
          {collapseCrumbs(crumbs).map((c, i, arr) =>
            c == null ? (
              <span key="ellipsis" className="flex items-center gap-1 text-muted-foreground">
                <span>/</span>
                <span>…</span>
              </span>
            ) : (
              <span key={c.id} className="flex items-center gap-1">
                <span className="text-muted-foreground">/</span>
                {i === arr.length - 1 ? (
                  <span className="font-semibold" data-testid={`drive-crumb-${c.id}`}>
                    {c.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openFolder(c.id)}
                    data-testid={`drive-crumb-${c.id}`}
                    className="text-primary hover:underline"
                  >
                    {c.name}
                  </button>
                )}
              </span>
            ),
          )}
        </nav>
      )}
      <div className="flex-1 overflow-y-auto p-4">
        {trash != null ? (
          <div data-testid="trash-view">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">휴지통 ({trash.length})</span>
              {trash.length > 0 && (
                <button
                  type="button"
                  onClick={onEmptyTrash}
                  className="text-xs text-destructive"
                  data-testid="empty-trash"
                >
                  휴지통 비우기
                </button>
              )}
            </div>
            <ul className="divide-y divide-border">
              {trash.map((it) => (
                <li key={`trash-${it.type}-${it.id}`} className="flex items-center gap-2 py-2">
                  <span className="flex-1 truncate text-sm">
                    {it.type === 'FOLDER' ? '📁' : '📄'} {it.name}
                    {it.originalPath && (
                      <span className="ml-2 text-xs text-muted-foreground">{it.originalPath}</span>
                    )}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {new Date(it.autoPurgeAt).toLocaleDateString()} 삭제 예정
                    </span>
                  </span>
                  <button type="button" onClick={() => onRestore(it)} className="text-xs text-primary">
                    복원
                  </button>
                  <button type="button" onClick={() => onPurge(it)} className="text-xs text-destructive">
                    영구삭제
                  </button>
                </li>
              ))}
              {trash.length === 0 && (
                <li className="py-8 text-center text-sm text-muted-foreground">휴지통이 비어 있습니다</li>
              )}
            </ul>
          </div>
        ) : searching ? (
          <ul className="divide-y divide-border" data-testid="search-results">
            {results.folders.map((f) => (
              <li key={`s-folder-${f.id}`} className="flex items-center gap-2 py-2">
                {/* 폴더 아이콘 — lucide Folder SVG로 파일 아이콘(DriveThumbnail)과 일관성 유지 */}
                <Folder className="h-8 w-8 shrink-0 p-1 text-muted-foreground" aria-hidden />
                <button
                  type="button"
                  onClick={() => openFolder(f.id)}
                  className="flex-1 text-left text-sm hover:underline"
                >
                  {f.name}
                  {f.folderPath && (
                    <span className="ml-2 text-xs text-muted-foreground">{f.folderPath}</span>
                  )}
                </button>
              </li>
            ))}
            {results.files.map((f) => (
              <li key={`s-file-${f.id}`} className="flex items-center gap-2 py-2">
                <DriveThumbnail fileId={f.id} category={f.category} />
                <button
                  type="button"
                  onClick={() => setPreview(f)}
                  className="flex-1 truncate text-left text-sm hover:underline"
                >
                  {f.name}
                  {f.folderPath && (
                    <span className="ml-2 text-xs text-muted-foreground">{f.folderPath}</span>
                  )}
                </button>
              </li>
            ))}
            {results.folders.length === 0 && results.files.length === 0 && (
              <li className="py-8 text-center text-sm text-muted-foreground">검색 결과가 없습니다</li>
            )}
          </ul>
        ) : (
          <ul className="divide-y divide-border">
            {items.folders.map((f) => (
              <li key={`folder-${f.id}`} className="flex items-center gap-2 py-2">
                {/* 폴더 아이콘 — lucide Folder SVG로 파일 아이콘(DriveThumbnail)과 일관성 유지 */}
                <Folder className="h-8 w-8 shrink-0 p-1 text-muted-foreground" aria-hidden />
                <button
                  type="button"
                  onClick={() => openFolder(f.id)}
                  className="flex-1 text-left text-sm hover:underline"
                >
                  {f.name}
                </button>
                <button
                  type="button"
                  onClick={() => onRenameFolder(f.id, f.name)}
                  className="text-xs text-muted-foreground"
                >
                  이름변경
                </button>
                <button
                  type="button"
                  onClick={() => setPicker({ mode: 'move', kind: 'folder', id: f.id, name: f.name })}
                  className="text-xs text-muted-foreground"
                >
                  이동
                </button>
                <button
                  type="button"
                  onClick={() => setPicker({ mode: 'copy', kind: 'folder', id: f.id, name: f.name })}
                  className="text-xs text-muted-foreground"
                >
                  복사
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteFolder(f.id)}
                  className="text-xs text-destructive"
                >
                  삭제
                </button>
              </li>
            ))}
            {items.files.map((f) => (
              <li key={`file-${f.id}`} className="flex items-center gap-2 py-2">
                <DriveThumbnail fileId={f.id} category={f.category} />
                <button
                  type="button"
                  onClick={() => setPreview(f)}
                  className="flex-1 truncate text-left text-sm hover:underline"
                >
                  {f.name}
                </button>
                <button
                  type="button"
                  onClick={() => driveApi.downloadFile(f.id, f.name)}
                  className="text-xs text-primary"
                >
                  다운로드
                </button>
                <button
                  type="button"
                  onClick={() => setPicker({ mode: 'move', kind: 'file', id: f.id, name: f.name })}
                  className="text-xs text-muted-foreground"
                >
                  이동
                </button>
                <button
                  type="button"
                  onClick={() => setPicker({ mode: 'copy', kind: 'file', id: f.id, name: f.name })}
                  className="text-xs text-muted-foreground"
                >
                  복사
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteFile(f.id)}
                  className="text-xs text-destructive"
                >
                  삭제
                </button>
              </li>
            ))}
            {items.folders.length === 0 && items.files.length === 0 && (
              <li className="py-8 text-center text-sm text-muted-foreground">비어 있습니다</li>
            )}
          </ul>
        )}

        {picker && (
          <FolderPickerModal
            spaceId={sid}
            title={`${picker.name} ${picker.mode === 'move' ? '이동' : '복사'}`}
            disabledFolderId={picker.kind === 'folder' ? picker.id : undefined}
            onConfirm={onPickTarget}
            onClose={() => setPicker(null)}
          />
        )}
        {preview && <FilePreviewModal file={preview} onClose={() => setPreview(null)} />}
      </div>

      {/* 폴더 이름 입력 다이얼로그 — 새 폴더 생성 / 이름 변경. window.prompt 대체 (#135). */}
      <Dialog
        open={nameDialog != null}
        onOpenChange={(open) => {
          if (!open) {
            setNameDialog(null)
            setNameInput('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{nameDialog?.mode === 'create' ? '새 폴더' : '폴더 이름 변경'}</DialogTitle>
          </DialogHeader>
          <Input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNameDialog()
            }}
            placeholder="폴더 이름"
            autoFocus
            data-testid="folder-name-input"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNameDialog(null)
                setNameInput('')
              }}
              data-testid="folder-name-cancel"
            >
              취소
            </Button>
            <Button onClick={() => void submitNameDialog()} data-testid="folder-name-confirm">
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 파괴적 작업 확인 AlertDialog — 삭제/영구삭제/휴지통 비우기. window.confirm 대체 (#135). */}
      <AlertDialog
        open={confirmDialog != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null)
        }}
      >
        <AlertDialogContent data-testid="drive-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="drive-confirm-cancel">취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = confirmDialog?.action
                void action?.()
              }}
              data-testid="drive-confirm-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmDialog?.actionLabel ?? '확인'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
