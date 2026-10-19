import { Folder } from 'lucide-react'
import { useState } from 'react'

import { useDriveItems } from '../../hooks/queries/useDriveItems'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { DriveThumbnail } from './DriveThumbnail'

interface Props {
  spaceId: number
  title: string
  /** 선택 모드: 'folder'(기본) = 폴더 탐색 후 대상 확정, 'file' = 파일 클릭으로 즉시 선택 */
  mode?: 'folder' | 'file'
  // 비활성화할 폴더(이동 중인 폴더 자신) — 진입·선택 불가. 하위 폴더(서브트리) 차단은 백엔드(400)가 담당.
  disabledFolderId?: number
  /** mode='folder' 일 때 확정 콜백 */
  onConfirm?: (targetId: number | null) => void
  /** mode='file' 일 때 파일 선택 콜백 */
  onPickFile?: (driveFileId: number, name: string) => void
  onClose: () => void
}

/**
 * 같은 공간의 폴더 트리를 탐색해 이동/복사 대상 폴더(또는 루트)를 고르는 모달.
 * mode='file' 시 파일 행도 렌더하고 클릭 시 onPickFile 호출 (footer 확정 버튼 숨김).
 * shadcn Dialog로 래핑하여 Esc 닫기·오버레이 클릭 닫기·포커스 트랩을 Radix가 자동 처리.
 */
export function FolderPickerModal({
  spaceId,
  title,
  mode = 'folder',
  disabledFolderId,
  onConfirm,
  onPickFile,
  onClose,
}: Props) {
  // 루트부터 지금 폴더까지 들어온 경로(이름 포함) — 경로 표시와 중간 단계로 돌아가기에 쓴다(WP-530).
  // 예전엔 지금 폴더 id 만 들고 「/ 폴더 9」처럼 내부 id 를 보였고 루트로만 돌아갈 수 있었다.
  const [trail, setTrail] = useState<{ id: number; name: string }[]>([])
  const current = trail.at(-1)?.id ?? null
  // WP-63: 현재 탐색 폴더의 내용 — DrivePage 와 같은 ['drive','items',spaceId,folderId] 키로 캐시를 공유해
  // resource.changed 무효화 시 함께 갱신된다. 폴더·파일은 응답에서 그대로 분리해 쓴다(미로드 시 빈 목록).
  const { data, isLoading } = useDriveItems(spaceId, current ?? undefined)
  const folders = data?.folders ?? []
  const files = data?.files ?? []

  return (
    // open 고정 true — 부모가 마운트/언마운트로 열기·닫기 제어함
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="w-80" data-testid="folder-picker">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <nav aria-label="폴더 경로" className="mb-2 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs" data-testid="folder-picker-path">
          {/* 지금 위치가 아닌 단계는 눌러서 그 단계로 돌아간다. 지금 위치는 글자만. */}
          {trail.length > 0 ? (
            <button type="button" onClick={() => setTrail([])} className="text-primary hover:underline">
              루트
            </button>
          ) : (
            <span aria-current="location" className="font-medium">루트</span>
          )}
          {trail.map((step, i) => (
            <span key={step.id} className="flex min-w-0 items-center gap-1">
              <span className="text-muted-foreground" aria-hidden>/</span>
              {i < trail.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setTrail(trail.slice(0, i + 1))}
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
        <ul className="mb-3 max-h-60 divide-y divide-border overflow-auto">
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                disabled={f.id === disabledFolderId}
                onClick={() => setTrail([...trail, { id: f.id, name: f.name }])}
                className="flex w-full items-center gap-2 py-1.5 text-left text-sm hover:underline disabled:opacity-40"
              >
                {/* 폴더 아이콘 — lucide Folder SVG, DrivePage와 일관성 유지 */}
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {f.name}
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
                  <DriveThumbnail fileId={f.fileId} category={f.category} mimeType={f.mimeType} />
                  <span className="truncate">{f.name}</span>
                </button>
              </li>
            ))}
          {/* WP-63: 첫 조회 중엔 빈 목록 문구를 숨긴다 — 폴더 이동 직후 거짓 "없음" 깜빡임 방지 */}
          {!isLoading && (mode === 'folder' ? folders.length === 0 : files.length === 0) && (
            <li className="py-4 text-center text-xs text-muted-foreground">
              {mode === 'file' ? '파일 없음' : '하위 폴더 없음'}
            </li>
          )}
        </ul>
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded border px-2 py-1 text-sm">
            취소
          </button>
          {/* folder 모드에서만 확정 버튼 표시 */}
          {mode === 'folder' && (
            <button
              type="button"
              disabled={current === disabledFolderId}
              onClick={() => onConfirm?.(current)}
              className="rounded bg-primary px-2 py-1 text-sm text-primary-foreground disabled:opacity-40"
              data-testid="folder-picker-confirm"
            >
              여기로
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
