import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { driveApi } from '../../api/drive'
import type { DriveItemList } from '../../types/drive'

/** 폴더 브라우저 — 브레드크럼 + 폴더·파일 목록 + 업로드/새폴더/이름변경/삭제/다운로드. */
export function DrivePage() {
  const { spaceId } = useParams()
  const sid = Number(spaceId)
  const [searchParams, setSearchParams] = useSearchParams()
  const folderParam = searchParams.get('folderId')
  const folderId = folderParam == null ? null : Number(folderParam)

  const [items, setItems] = useState<DriveItemList>({ folders: [], files: [] })
  const fileInput = useRef<HTMLInputElement>(null)

  async function reload() {
    const { data } = await driveApi.listItems(sid, folderId)
    setItems(data)
  }
  useEffect(() => {
    if (!Number.isNaN(sid)) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, folderId])

  function openFolder(id: number) {
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
    if (!window.confirm('폴더를 삭제할까요? 하위 항목도 삭제됩니다.')) return
    await driveApi.deleteFolder(id)
    await reload()
  }
  async function onDeleteFile(id: number) {
    if (!window.confirm('파일을 삭제할까요?')) return
    await driveApi.deleteFile(id)
    await reload()
  }

  return (
    <div className="p-4" data-testid="drive-page">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={goRoot} className="text-sm text-primary hover:underline">
          루트
        </button>
        {folderId != null && (
          <span className="text-sm text-muted-foreground">/ 폴더 {folderId}</span>
        )}
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
        </div>
      </div>

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
              onClick={() => onDeleteFolder(f.id)}
              className="text-xs text-destructive"
            >
              삭제
            </button>
          </li>
        ))}
        {items.files.map((f) => (
          <li key={`file-${f.id}`} className="flex items-center gap-2 py-2">
            <span className="flex-1 truncate text-sm">📄 {f.name}</span>
            <button
              type="button"
              onClick={() => driveApi.downloadFile(f.id, f.name)}
              className="text-xs text-primary"
            >
              다운로드
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
    </div>
  )
}
