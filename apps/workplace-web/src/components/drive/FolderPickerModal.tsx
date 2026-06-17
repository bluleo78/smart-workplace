import { Folder } from 'lucide-react'
import { useEffect, useState } from 'react'

import { driveApi } from '../../api/drive'
import type { DriveFolder } from '../../types/drive'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

interface Props {
  spaceId: number
  title: string
  // 비활성화할 폴더(이동 중인 폴더 자신) — 진입·선택 불가. 하위 폴더(서브트리) 차단은 백엔드(400)가 담당.
  disabledFolderId?: number
  onConfirm: (targetId: number | null) => void
  onClose: () => void
}

/**
 * 같은 공간의 폴더 트리를 탐색해 이동/복사 대상 폴더(또는 루트)를 고르는 모달.
 * shadcn Dialog로 래핑하여 Esc 닫기·오버레이 클릭 닫기·포커스 트랩을 Radix가 자동 처리.
 */
export function FolderPickerModal({ spaceId, title, disabledFolderId, onConfirm, onClose }: Props) {
  const [current, setCurrent] = useState<number | null>(null)
  const [folders, setFolders] = useState<DriveFolder[]>([])

  useEffect(() => {
    void driveApi.listItems(spaceId, current).then(({ data }) => setFolders(data.folders))
  }, [spaceId, current])

  return (
    // open 고정 true — 부모가 마운트/언마운트로 열기·닫기 제어함
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="w-80" data-testid="folder-picker">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <div className="mb-2 flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setCurrent(null)}
            className="text-primary hover:underline"
          >
            루트
          </button>
          {current != null && <span className="text-muted-foreground">/ 폴더 {current}</span>}
        </div>
        <ul className="mb-3 max-h-60 divide-y divide-border overflow-auto">
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                disabled={f.id === disabledFolderId}
                onClick={() => setCurrent(f.id)}
                className="flex w-full items-center gap-2 py-1.5 text-left text-sm hover:underline disabled:opacity-40"
              >
                {/* 폴더 아이콘 — lucide Folder SVG, DrivePage와 일관성 유지 */}
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {f.name}
              </button>
            </li>
          ))}
          {folders.length === 0 && (
            <li className="py-4 text-center text-xs text-muted-foreground">하위 폴더 없음</li>
          )}
        </ul>
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded border px-2 py-1 text-sm">
            취소
          </button>
          <button
            type="button"
            disabled={current === disabledFolderId}
            onClick={() => onConfirm(current)}
            className="rounded bg-primary px-2 py-1 text-sm text-primary-foreground disabled:opacity-40"
            data-testid="folder-picker-confirm"
          >
            여기로
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
