import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { driveApi } from '../../api/drive'
import { DriveThumbnail } from '../../components/drive/DriveThumbnail'
import { FilePreviewModal } from '../../components/drive/FilePreviewModal'
import { FolderPickerModal } from '../../components/drive/FolderPickerModal'
import { SearchInput } from '../../components/ui/search-input'
import type { DriveFile, DriveItemList, DriveSearchResult, DriveTrashItem } from '../../types/drive'

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

  async function reload() {
    const { data } = await driveApi.listItems(sid, folderId)
    setItems(data)
  }
  useEffect(() => {
    if (!Number.isNaN(sid)) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, folderId])

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

  async function onNewFolder() {
    const name = window.prompt('새 폴더 이름')
    if (!name) return
    await driveApi.createFolder(sid, folderId, name)
    await reload()
  }
  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await driveApi.uploadFile(sid, folderId, file)
    e.target.value = ''
    await reload()
  }
  async function onRenameFolder(id: number, current: string) {
    const name = window.prompt('폴더 이름 변경', current)
    if (!name) return
    await driveApi.renameFolder(id, name)
    await reload()
  }
  async function onDeleteFolder(id: number) {
    if (!window.confirm('폴더를 휴지통으로 보낼까요? 30일 후 자동 삭제됩니다.')) return
    await driveApi.deleteFolder(id)
    await reload()
  }
  async function onDeleteFile(id: number) {
    if (!window.confirm('파일을 휴지통으로 보낼까요? 30일 후 자동 삭제됩니다.')) return
    await driveApi.deleteFile(id)
    await reload()
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
    } catch {
      window.alert('이동/복사할 수 없는 위치입니다.')
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
  async function onRestore(it: DriveTrashItem) {
    if (it.type === 'FOLDER') await driveApi.restoreFolder(it.id)
    else await driveApi.restoreFile(it.id)
    await reloadTrash()
  }
  async function onPurge(it: DriveTrashItem) {
    if (!window.confirm(`'${it.name}' 을(를) 영구 삭제할까요? 되돌릴 수 없습니다.`)) return
    if (it.type === 'FOLDER') await driveApi.purgeFolder(it.id)
    else await driveApi.purgeFile(it.id)
    await reloadTrash()
  }
  async function onEmptyTrash() {
    if (!window.confirm('휴지통을 비울까요? 모든 항목이 영구 삭제됩니다.')) return
    await driveApi.emptyTrash(sid)
    await reloadTrash()
  }

  const searching = results != null

  return (
    <div className="p-4" data-testid="drive-page">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={goRoot} className="text-sm text-primary hover:underline">
          루트
        </button>
        {folderId != null && !searching && (
          <span className="text-sm text-muted-foreground">/ 폴더 {folderId}</span>
        )}
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="이 공간에서 검색..."
          aria-label="드라이브 검색"
          className="ml-2"
        />
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onNewFolder}
            className="rounded border px-2 py-1 text-sm hover:bg-accent/50"
          >
            새 폴더
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded bg-primary px-2 py-1 text-sm text-primary-foreground hover:opacity-90"
          >
            업로드
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
        </div>
      </div>

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
              <button
                type="button"
                onClick={() => openFolder(f.id)}
                className="flex-1 text-left text-sm hover:underline"
              >
                📁 {f.name}
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
              <button
                type="button"
                onClick={() => openFolder(f.id)}
                className="flex-1 text-left text-sm hover:underline"
              >
                📁 {f.name}
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
  )
}
