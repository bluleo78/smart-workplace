import { FileText, Folder, FolderOpen, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { handleApiError } from '@/lib/api-error'

import { driveApi } from '../../api/drive'
import { DriveSearchBar } from '../../components/drive/DriveSearchBar'
import { DriveThumbnail } from '../../components/drive/DriveThumbnail'
import { FilePreviewModal } from '../../components/drive/FilePreviewModal'
import { FolderPickerModal } from '../../components/drive/FolderPickerModal'
import { RowOverflowMenu } from '../../components/drive/RowOverflowMenu'
import { ShareLinkModal } from '../../components/drive/ShareLinkModal'
import { VersionHistoryModal } from '../../components/drive/VersionHistoryModal'
import { SearchInput } from '../../components/ui/search-input'
import type { DriveFile, DriveFolderPathSegment, DriveItemList, DriveSearchResult, DriveSpace, DriveTrashItem } from '../../types/drive'
import { type DroppedFile,readDroppedTree } from './folderUpload'
import { useFolderNavigation } from './useFolderNavigation'

// 서버 multipart 업로드 한도(application.yml: max-file-size 25MB)와 동일. 초과 시 업로드 전 안내.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

// breadcrumb 접기 — 4개 초과면 [첫, null(…), 마지막2개]. null 은 생략 표식.
function collapseCrumbs(
  crumbs: DriveFolderPathSegment[],
): (DriveFolderPathSegment | null)[] {
  if (crumbs.length <= 4) return crumbs
  return [crumbs[0], null, crumbs[crumbs.length - 2], crumbs[crumbs.length - 1]]
}

/** 폴더 브라우저 — 검색 + 브레드크럼 + 폴더·파일 목록 + 업로드/새폴더/이름변경/삭제/미리보기/다운로드.
 *  spaceId prop 이 오면 임베드(드로워) 모드 — 폴더 탐색을 state 로 보관해 상위 URL 을 건드리지 않는다.
 *  미지정 시 URL(useParams/useSearchParams) 로 구동하는 풀페이지 모드. */
export function DrivePage({ spaceId: spaceIdProp }: { spaceId?: number } = {}) {
  const params = useParams()
  const sid = spaceIdProp ?? Number(params.spaceId)
  const embedded = spaceIdProp != null
  const folderNav = useFolderNavigation(embedded ? 'state' : 'url')
  const folderId = folderNav.folderId

  // #76: 공간 메타데이터 — archived 여부로 읽기 전용 배너·액션 버튼 비활성 결정.
  const [space, setSpace] = useState<DriveSpace | null>(null)
  const [items, setItems] = useState<DriveItemList>({ folders: [], files: [] })
  const fileInput = useRef<HTMLInputElement>(null)
  const [picker, setPicker] = useState<
    { mode: 'move' | 'copy'; kind: 'file' | 'folder'; id: number; name: string } | null
  >(null)
  const [preview, setPreview] = useState<DriveFile | null>(null)
  // 공유 링크 모달 대상 파일 — null 이면 닫힘.
  const [shareFile, setShareFile] = useState<DriveFile | null>(null)
  // 버전 이력 모달 대상 파일 — null 이면 닫힘.
  const [versionFile, setVersionFile] = useState<DriveFile | null>(null)

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
  // 빈값 확인 클릭 시 에러 메시지 — 무음 실패 대신 인라인 안내 (#360).
  const [nameError, setNameError] = useState('')

  // 파일 업로드 진행 상태 — 업로드 중 버튼 비활성화·텍스트 변경으로 중복 업로드 방지 (#170).
  const [uploading, setUploading] = useState(false)

  // #82: 폴더 드래그앤드롭 업로드 상태.
  const [dropProgress, setDropProgress] = useState<{ done: number; total: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // #82: 멀티셀렉트 상태 — 선택된 파일/폴더 id 집합 + 벌크 이동 picker 가시성.
  const [selFiles, setSelFiles] = useState<Set<number>>(new Set())
  const [selFolders, setSelFolders] = useState<Set<number>>(new Set())
  const [bulkPicker, setBulkPicker] = useState(false)
  const selCount = selFiles.size + selFolders.size

  // 토글 헬퍼 — 집합에 id 가 있으면 제거, 없으면 추가해 새 집합 반환.
  function toggleSel(set: Set<number>, id: number): Set<number> {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  // 선택 초기화 — 폴더/아이템 변경 시 호출.
  function clearSel() {
    setSelFiles(new Set())
    setSelFolders(new Set())
  }

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
    // #588: 검색 결과 화면에서 벌크 작업(이동/삭제) 후에도 검색 결과가 갱신되도록
    // 검색 중이면 동일 질의로 재검색 — 아니면 삭제/이동된 항목이 결과에 잔존 표시됨.
    const q = query.trim()
    if (results != null && q.length >= 2) {
      const { data: searchData } = await driveApi.search(sid, q)
      setResults(searchData)
    }
    // 폴더/공간 변경 시 선택 초기화 — stale 선택이 벌크 작업에 섞이지 않도록.
    clearSel()
  }
  // 아이템 목록은 공간/폴더 변경 시마다 갱신(폴더 진입 포함).
  useEffect(() => {
    if (!Number.isNaN(sid)) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, folderId])

  // #76: 공간 메타데이터(archived 등)는 공간 변경 시 1회 조회 — 실패 시 배너 미표시로 폴백.
  useEffect(() => {
    if (!Number.isNaN(sid)) {
      driveApi
        .getSpace(sid)
        .then((r) => setSpace(r.data))
        .catch(() => undefined)
    }
  }, [sid])

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
    folderNav.openFolder(id)
  }
  function goRoot() {
    folderNav.goRoot()
  }

  // 폴더 이름 다이얼로그 확인 — 생성/이름변경 API 호출 후 목록 갱신.
  // trim 없이 raw 값을 전송 — 공백만 입력 시 서버 @NotBlank 400 → 토스트 안내(#116 동작 보존).
  // 완전 빈값(empty string)은 인라인 에러로 안내 — 무음 실패 방지 (#360).
  async function submitNameDialog() {
    if (!nameDialog) return
    if (!nameInput) {
      setNameError('폴더 이름을 입력해주세요.')
      return
    }
    const dialog = nameDialog
    setNameDialog(null)
    setNameInput('')
    setNameError('')
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

  // #82: 드롭된 폴더 트리를 구조 재생(resolveFolder=merge) 후 파일을 순차 업로드.
  // 부분 실패는 성공분 유지 + 실패 요약 토스트(롤백 없음).
  async function uploadDroppedTree(dropped: DroppedFile[]) {
    if (dropped.length === 0) return
    setDropProgress({ done: 0, total: dropped.length })
    // 경로(상위 폴더 체인) → folderId 캐시. 루트는 현재 folderId.
    const folderCache = new Map<string, number | null>()
    folderCache.set('', folderId)
    const failures: string[] = []

    async function ensureFolder(path: string[]): Promise<number | null> {
      const key = path.join('/')
      if (folderCache.has(key)) return folderCache.get(key)!
      const parent = await ensureFolder(path.slice(0, -1))
      const { data } = await driveApi.resolveFolder(sid, parent, path[path.length - 1])
      folderCache.set(key, data.id)
      return data.id
    }

    let done = 0
    for (const d of dropped) {
      try {
        if (d.file.size > MAX_UPLOAD_BYTES) {
          failures.push(`${d.file.name} (25MB 초과)`)
        } else {
          const target = await ensureFolder(d.relativePath)
          await driveApi.uploadFile(sid, target, d.file)
        }
      } catch {
        failures.push(d.file.name)
      } finally {
        done += 1
        setDropProgress({ done, total: dropped.length })
      }
    }

    setDropProgress(null)
    await reload()
    if (failures.length > 0) {
      toast.error(`${failures.length}개 항목 업로드 실패: ${failures.slice(0, 3).join(', ')}${failures.length > 3 ? ' 외' : ''}`)
    } else {
      toast.success(`${dropped.length}개 파일 업로드 완료`)
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (space?.archived) return
    const dropped = await readDroppedTree(e.dataTransfer.items)
    await uploadDroppedTree(dropped)
  }

  function onNewFolder() {
    setNameInput('')
    setNameError('')
    setNameDialog({ mode: 'create' })
  }
  // #589: 업로드 버튼 경로도 드래그앤드롭(uploadDroppedTree)과 동일하게 다중 파일을 지원.
  // input[multiple] 로 선택된 파일 전체를 순차 업로드하고 부분 실패는 성공분 유지 + 실패 요약 토스트.
  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return

    // 단일 파일: 기존 동작 그대로(개별 에러 토스트, 진행률 표시 없음).
    if (files.length === 1) {
      const file = files[0]
      // 한도 초과는 업로드 전 클라이언트에서 안내 — 불필요한 400 왕복·데이터 유실 오인 방지.
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error('파일 크기가 25MB를 초과합니다.')
        return
      }
      // 업로드 시작 — 버튼 비활성화로 중복 업로드 방지 (#170).
      setUploading(true)
      try {
        await driveApi.uploadFile(sid, folderId, file)
        await reload()
      } catch (err) {
        handleApiError(err, '파일을 업로드하지 못했습니다.')
      } finally {
        setUploading(false)
      }
      return
    }

    // 다중 파일: 드롭 경로와 동일한 순차 업로드 + 실패 집계 패턴.
    setUploading(true)
    setDropProgress({ done: 0, total: files.length })
    const failures: string[] = []
    let done = 0
    try {
      for (const file of files) {
        try {
          if (file.size > MAX_UPLOAD_BYTES) {
            failures.push(`${file.name} (25MB 초과)`)
          } else {
            await driveApi.uploadFile(sid, folderId, file)
          }
        } catch {
          failures.push(file.name)
        } finally {
          done += 1
          setDropProgress({ done, total: files.length })
        }
      }
      await reload()
      if (failures.length > 0) {
        toast.error(`${failures.length}개 항목 업로드 실패: ${failures.slice(0, 3).join(', ')}${failures.length > 3 ? ' 외' : ''}`)
      } else {
        toast.success(`${files.length}개 파일 업로드 완료`)
      }
    } finally {
      setDropProgress(null)
      setUploading(false)
    }
  }
  function onRenameFolder(id: number, current: string) {
    setNameInput(current)
    setNameError('')
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

  // #82: 벌크 작업 공통 선택 body 생성.
  function selectionBody() {
    return { fileIds: [...selFiles], folderIds: [...selFolders] }
  }

  async function onBulkZip() {
    try {
      await driveApi.downloadZip(sid, selectionBody())
    } catch (e) {
      handleApiError(e, 'ZIP 다운로드에 실패했습니다.')
    }
  }

  function onBulkDelete() {
    // window.confirm 대신 기존 단건 삭제와 동일한 confirmDialog AlertDialog 패턴으로 통일 (#82 폴리시).
    const body = selectionBody()
    const count = selCount
    setConfirmDialog({
      title: '벌크 삭제',
      description: `선택한 ${count}개 항목을 휴지통으로 보낼까요? 30일 후 자동 삭제됩니다.`,
      actionLabel: '삭제',
      action: async () => {
        try {
          await driveApi.bulkDelete(sid, body)
          await reload()
        } catch (e) {
          handleApiError(e, '삭제에 실패했습니다.')
        }
      },
    })
  }

  async function onBulkMoveTarget(targetId: number | null) {
    try {
      await driveApi.bulkMove(sid, { ...selectionBody(), targetFolderId: targetId })
    } catch (e) {
      handleApiError(e, '이동할 수 없는 위치입니다.')
    } finally {
      setBulkPicker(false)
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

  // #588: 벌크 툴바 — 검색/비검색 두 목록 분기가 공유하는 렌더 헬퍼(중복 제거).
  // 1개 이상 선택 시 표시.
  function renderBulkToolbar() {
    if (selCount === 0) return null
    return (
      <div
        data-testid="bulk-toolbar"
        className="mb-2 flex items-center gap-2 rounded bg-muted px-3 py-2 text-sm"
      >
        <span>선택 {selCount}개</span>
        <button
          type="button"
          data-testid="bulk-move"
          onClick={() => setBulkPicker(true)}
          disabled={!!space?.archived}
          className="text-muted-foreground hover:underline disabled:opacity-50"
        >
          이동
        </button>
        <button
          type="button"
          data-testid="bulk-zip"
          onClick={onBulkZip}
          className="text-primary hover:underline"
        >
          ZIP 다운로드
        </button>
        <button
          type="button"
          data-testid="bulk-delete"
          onClick={onBulkDelete}
          disabled={!!space?.archived}
          className="text-destructive hover:underline disabled:opacity-50"
        >
          삭제
        </button>
        <button
          type="button"
          data-testid="bulk-clear"
          onClick={clearSel}
          className="ml-auto text-muted-foreground hover:underline"
        >
          선택 해제
        </button>
      </div>
    )
  }

  // #588: 전체선택 체크박스 — 검색/비검색 두 목록 분기가 공유하는 렌더 헬퍼.
  // 대상 폴더/파일 id 목록을 인자로 받아 현재 뷰(검색 결과 또는 폴더 목록) 기준으로 동작.
  function renderSelectAll(folderIds: number[], fileIds: number[]) {
    const total = folderIds.length + fileIds.length
    if (total === 0) return null
    const allSelected = selCount > 0 && selCount === total
    return (
      <div className="mb-1 flex items-center gap-2 px-0.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => {
            if (allSelected) {
              clearSel()
            } else {
              setSelFolders(new Set(folderIds))
              setSelFiles(new Set(fileIds))
            }
          }}
          data-testid="select-all"
          className="h-4 w-4 shrink-0"
        />
        <span>전체선택</span>
      </div>
    )
  }

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
              disabled={!!space?.archived}
              className="rounded border px-2 py-1 text-sm hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              새 폴더
            </button>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              data-testid="drive-upload"
              disabled={uploading || !!space?.archived}
              className="rounded bg-primary px-2 py-1 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? '업로드 중…' : '업로드'}
            </button>
            <input ref={fileInput} type="file" multiple hidden onChange={onUpload} data-testid="file-input" />
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
      <div
        className="flex-1 overflow-y-auto p-4"
        data-testid="drive-dropzone"
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={dragOver ? { outline: '2px solid var(--color-primary)', borderRadius: '0.375rem' } : undefined}
      >
        {/* 콘텐츠 시맨틱 검색 — 스페이스 범위 파일명 검색과 별도로 전체 콘텐츠 하이브리드 검색 제공. */}
        {!embedded && <div className="mb-4" data-testid="drive-content-search"><DriveSearchBar /></div>}
        {/* #76: 보관된 채널에 연동된 공간 — 읽기 전용 배너. */}
        {space?.archived && (
          <div
            data-testid="drive-readonly-banner"
            className="mb-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
          >
            보관된 채널의 공간입니다 — 읽기 전용입니다.
          </div>
        )}
        {/* #82: 폴더 드롭 업로드 진행 표시 */}
        {dropProgress && (
          <div data-testid="drop-progress" className="mb-2 text-sm text-muted-foreground">
            업로드 중… {dropProgress.done}/{dropProgress.total}
          </div>
        )}
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
                  <span className="flex flex-1 items-center gap-1.5 truncate text-sm">
                    {it.type === 'FOLDER' ? (
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    {it.name}
                    {it.originalPath && (
                      <span className="ml-2 text-xs text-muted-foreground">{it.originalPath}</span>
                    )}
                    {/* autoPurgeAt이 null이면 날짜 표시 생략(서버가 미설정한 경우) */}
                    {it.autoPurgeAt && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {new Date(it.autoPurgeAt).toLocaleDateString()} 삭제 예정
                      </span>
                    )}
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
          <>
            {/* #588: 검색 결과에도 비검색 모드와 동일한 벌크 선택 UI 적용. */}
            {renderBulkToolbar()}
            {renderSelectAll(
              results.folders.map((f) => f.id),
              results.files.map((f) => f.id),
            )}
            <ul className="divide-y divide-border" data-testid="search-results">
              {results.folders.map((f) => (
                <li key={`s-folder-${f.id}`} className="flex items-center gap-2 py-2">
                  {/* #588: 폴더 행 체크박스 — 멀티셀렉트용. */}
                  <input
                    type="checkbox"
                    checked={selFolders.has(f.id)}
                    onChange={() => setSelFolders((s) => toggleSel(s, f.id))}
                    data-testid={`select-folder-${f.id}`}
                    className="h-4 w-4 shrink-0"
                  />
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
                  {/* #588: 파일 행 체크박스 — 멀티셀렉트용. */}
                  <input
                    type="checkbox"
                    checked={selFiles.has(f.id)}
                    onChange={() => setSelFiles((s) => toggleSel(s, f.id))}
                    data-testid={`select-file-${f.id}`}
                    className="h-4 w-4 shrink-0"
                  />
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
          </>
        ) : (
          <>
            {/* #82/#588: 벌크 툴바 + 전체선택 — 검색 결과 분기와 공유하는 렌더 헬퍼. */}
            {renderBulkToolbar()}
            {renderSelectAll(
              items.folders.map((f) => f.id),
              items.files.map((f) => f.id),
            )}
          <ul className="divide-y divide-border">
            {items.folders.map((f) => (
              <li key={`folder-${f.id}`} className="group flex items-center gap-2 py-2">
                {/* #82: 폴더 행 체크박스 — 멀티셀렉트용. */}
                <input
                  type="checkbox"
                  checked={selFolders.has(f.id)}
                  onChange={() => setSelFolders((s) => toggleSel(s, f.id))}
                  data-testid={`select-folder-${f.id}`}
                  className="h-4 w-4 shrink-0"
                />
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
                  disabled={!!space?.archived}
                  className="hidden text-xs text-muted-foreground group-hover:inline-flex disabled:opacity-50"
                >
                  이름변경
                </button>
                <button
                  type="button"
                  onClick={() => setPicker({ mode: 'move', kind: 'folder', id: f.id, name: f.name })}
                  disabled={!!space?.archived}
                  className="hidden text-xs text-muted-foreground group-hover:inline-flex disabled:opacity-50"
                >
                  이동
                </button>
                <button
                  type="button"
                  onClick={() => setPicker({ mode: 'copy', kind: 'folder', id: f.id, name: f.name })}
                  disabled={!!space?.archived}
                  className="hidden text-xs text-muted-foreground group-hover:inline-flex disabled:opacity-50"
                >
                  복사
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteFolder(f.id)}
                  disabled={!!space?.archived}
                  className="hidden text-xs text-destructive group-hover:inline-flex disabled:opacity-50"
                >
                  삭제
                </button>
              </li>
            ))}
            {items.files.map((f) => (
              <li key={`file-${f.id}`} className="group flex items-center gap-2 rounded px-1 py-2 hover:bg-accent/40">
                {/* #82: 파일 행 체크박스 — 멀티셀렉트용. */}
                <input
                  type="checkbox"
                  checked={selFiles.has(f.id)}
                  onChange={() => setSelFiles((s) => toggleSel(s, f.id))}
                  data-testid={`select-file-${f.id}`}
                  className="h-4 w-4 shrink-0"
                />
                <DriveThumbnail fileId={f.id} category={f.category} />
                <button
                  type="button"
                  onClick={() => setPreview(f)}
                  className="flex-1 truncate text-left text-sm hover:underline"
                >
                  {f.name}
                </button>
                {/* 버전 뱃지 — 버전이 2개 이상일 때만 표시(#79) */}
                {f.versionCount > 1 && (
                  <span
                    className="rounded bg-muted px-1 text-xs text-muted-foreground"
                    data-testid="version-badge"
                  >
                    v{f.versionCount}
                  </span>
                )}
                {/* 행 액션 — 호버/포커스 시 노출. 주요 3개 인라인 + 더보기(⋯). 핸들러는 기존 그대로. */}
                <div data-file-actions className="hidden items-center gap-0.5 group-hover:flex">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => driveApi.downloadFile(f.id, f.name)}
                    aria-label={`${f.name} 다운로드`}
                  >
                    다운로드
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setShareFile(f)}
                    aria-label={`${f.name} 공유 링크`}
                    data-testid="share-link-btn"
                  >
                    공유
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => onDeleteFile(f.id)}
                    disabled={!!space?.archived}
                    className="text-destructive hover:text-destructive"
                    aria-label={`${f.name} 삭제`}
                  >
                    삭제
                  </Button>
                  <RowOverflowMenu
                    triggerAriaLabel={`${f.name} 더보기`}
                    items={[
                      { label: '버전 이력', onSelect: () => setVersionFile(f) },
                      {
                        label: '이동',
                        onSelect: () => setPicker({ mode: 'move', kind: 'file', id: f.id, name: f.name }),
                        disabled: !!space?.archived,
                      },
                      {
                        label: '복사',
                        onSelect: () => setPicker({ mode: 'copy', kind: 'file', id: f.id, name: f.name }),
                        disabled: !!space?.archived,
                      },
                    ]}
                  />
                </div>
              </li>
            ))}
            {items.folders.length === 0 && items.files.length === 0 && (
              // 빈 폴더 empty state — DS §2.5: 아이콘+제목+설명+CTA 4요소.
              <li
                className="flex flex-col items-center gap-2 px-4 py-12 text-center"
                data-testid="drive-empty-folder"
              >
                <FolderOpen className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm font-semibold">이 폴더는 비어 있어요</p>
                <p className="text-xs text-muted-foreground">파일을 업로드하거나 새 폴더를 만들어보세요</p>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-accent"
                >
                  <Upload className="h-3.5 w-3.5" />
                  업로드
                </button>
              </li>
            )}
          </ul>
          </>
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
        {/* #82: 벌크 이동 picker — 선택 항목을 대상 폴더로 일괄 이동. */}
        {bulkPicker && (
          <FolderPickerModal
            spaceId={sid}
            title={`${selCount}개 항목 이동`}
            onConfirm={onBulkMoveTarget}
            onClose={() => setBulkPicker(false)}
          />
        )}
        {preview && <FilePreviewModal file={preview} onClose={() => setPreview(null)} />}
        {shareFile && <ShareLinkModal file={shareFile} onClose={() => setShareFile(null)} />}
        {versionFile && (
          <VersionHistoryModal
            file={versionFile}
            open={!!versionFile}
            onClose={() => setVersionFile(null)}
            onChanged={reload}
          />
        )}
      </div>

      {/* 폴더 이름 입력 다이얼로그 — 새 폴더 생성 / 이름 변경. window.prompt 대체 (#135). */}
      <Dialog
        open={nameDialog != null}
        onOpenChange={(open) => {
          if (!open) {
            setNameDialog(null)
            setNameInput('')
            setNameError('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{nameDialog?.mode === 'create' ? '새 폴더' : '폴더 이름 변경'}</DialogTitle>
            {/* 스크린 리더용 다이얼로그 설명 — Radix UI 접근성 경고 해소 (#361) */}
            <DialogDescription className="sr-only">
              {nameDialog?.mode === 'create' ? '새 폴더 이름을 입력하세요' : '폴더의 새 이름을 입력하세요'}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nameInput}
            onChange={(e) => {
              setNameInput(e.target.value)
              // 입력 시 에러 메시지 즉시 제거 — 피드백 루프 개선 (#360)
              if (nameError) setNameError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNameDialog()
            }}
            placeholder="폴더 이름"
            autoFocus
            aria-invalid={nameError ? 'true' : undefined}
            data-testid="folder-name-input"
          />
          {/* 빈값 제출 시 인라인 에러 메시지 — 무음 실패 대신 안내 (#360) */}
          {nameError && (
            <p className="text-sm text-destructive" role="alert" data-testid="folder-name-error">
              {nameError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNameDialog(null)
                setNameInput('')
                setNameError('')
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
