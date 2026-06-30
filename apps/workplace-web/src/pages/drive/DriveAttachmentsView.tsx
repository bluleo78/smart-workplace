// #80: 드라이브 가상 첨부 뷰 — 이슈/메시지에서 업로드된 파일을 시간순 플랫 리스트로 표시.
// 출처 필터(전체/이슈/메시지) + 이름 검색 + 행별 "저장"(내 드라이브 임포트) 지원.

import { ChevronDown, Paperclip } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { driveApi } from '@/api/drive'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { DriveThumbnail } from '@/components/drive/DriveThumbnail'
import { FilePreviewModal } from '@/components/drive/FilePreviewModal'
import { FolderPickerModal } from '@/components/drive/FolderPickerModal'
import { SearchInput } from '@/components/ui/search-input'
import { useDriveAttachments } from '@/hooks/queries/useDriveAttachments'
import { useImportAttachment } from '@/hooks/queries/useImportAttachment'
import { mimeToCategory } from '@/lib/fileCategory'
import { formatFileSize } from '@/lib/formatters'
import { LABEL_COLORS } from '@/lib/labelColors'
import { cn } from '@/lib/utils'
import type { DriveSpace, VirtualAttachment } from '@/types/drive'

import { groupAttachments } from './groupAttachments'

type SourceFilter = 'ALL' | 'ISSUE' | 'MESSAGE'

const SOURCE_LABELS: Record<SourceFilter, string> = {
  ALL: '전체',
  ISSUE: '이슈',
  MESSAGE: '메시지',
}

/** 이슈/메시지 가상 첨부 뷰 — 출처 필터칩 + 이름 검색 + 행별 드라이브 저장. */
export function DriveAttachmentsView() {
  const [source, setSource] = useState<SourceFilter>('ALL')
  const [q, setQ] = useState('')
  const query = useDriveAttachments({ source, q })
  const importMut = useImportAttachment()

  // 내 드라이브(PERSONAL) 공간 ID — 저장 시 임포트 대상 공간.
  const [personalSpaceId, setPersonalSpaceId] = useState<number | null>(null)
  // 공간 조회 완료 여부 — 로딩 중 disabled 와 조회 실패 disabled 를 구분하기 위해 사용.
  const [spacesResolved, setSpacesResolved] = useState(false)
  const [importing, setImporting] = useState<VirtualAttachment | null>(null)
  // 미리보기 모달 대상 첨부.
  const [preview, setPreview] = useState<VirtualAttachment | null>(null)
  // 접힌 그룹 key 집합(기본 모두 펼침). 세션 임시 — localStorage 미사용.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  useEffect(() => {
    let mounted = true
    void driveApi
      .listSpaces()
      .then(({ data }) => {
        if (!mounted) return
        const personal = (data as DriveSpace[]).find((s) => s.type === 'PERSONAL')
        if (personal) setPersonalSpaceId(personal.id)
        setSpacesResolved(true)
      })
      .catch(() => {
        if (!mounted) return
        toast.error('드라이브 스페이스를 불러오지 못했습니다.')
        setSpacesResolved(true)
      })
    return () => {
      mounted = false
    }
  }, [])

  const items = query.data?.pages.flatMap((p) => p.items) ?? []
  const isLoading = query.isLoading

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="drive-attachments-view">
      {/* 상단 바 — 검색 + 출처 필터칩 */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="파일 이름 검색…"
          aria-label="파일 이름 검색"
        />
        {(['ALL', 'ISSUE', 'MESSAGE'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            data-testid={`drive-attachment-filter-${s.toLowerCase()}`}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
              source === s
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-border text-muted-foreground hover:bg-accent/50',
            )}
          >
            {SOURCE_LABELS[s]}
          </button>
        ))}
      </div>

      {/* 본문 — 로딩/빈상태/목록 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            불러오는 중…
          </div>
        ) : items.length === 0 ? (
          <ChatEmptyState
            icon={<Paperclip className="h-10 w-10" />}
            title="첨부가 없어요"
            description="접근 가능한 이슈·메시지의 첨부가 여기에 모입니다"
          />
        ) : (
          <div>
            {groupAttachments(items).map((g) => {
              const isCollapsed = collapsed.has(g.key)
              const isIssue = g.sourceType === 'ISSUE'
              return (
                <div key={g.key} data-testid="drive-attachment-group" data-group-key={g.key}>
                  {/* 그룹 헤더 — 셰브론(토글) + 유형 배지 + 출처 라벨(딥링크) */}
                  <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.key)}
                      aria-label={isCollapsed ? '펼치기' : '접기'}
                      aria-expanded={!isCollapsed}
                      data-testid="drive-attachment-group-toggle"
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
                    >
                      <ChevronDown
                        className={cn('h-4 w-4 transition-transform', isCollapsed && '-rotate-90')}
                      />
                    </button>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        isIssue
                          ? `${LABEL_COLORS.PURPLE.bg} ${LABEL_COLORS.PURPLE.text}`
                          : `${LABEL_COLORS.CYAN.bg} ${LABEL_COLORS.CYAN.text}`
                      }`}
                    >
                      {isIssue ? '이슈' : '메시지'}
                    </span>
                    <a
                      href={g.deepLink}
                      className="min-w-0 truncate text-sm font-medium hover:underline"
                    >
                      {g.sourceLabel}
                    </a>
                  </div>

                  {/* 그룹 항목 */}
                  {!isCollapsed && (
                    <ul className="divide-y divide-border">
                      {g.items.map((a) => (
                        <li
                          key={`${a.sourceType}-${a.fileId}`}
                          data-testid={`drive-attachment-row-${a.fileId}`}
                          className="group flex items-center gap-3 px-4 py-2 pl-10 text-sm hover:bg-accent/40"
                        >
                          <DriveThumbnail fileId={a.fileId} category={mimeToCategory(a.mimeType)} />

                          {/* 파일명 — 클릭 시 미리보기 */}
                          <button
                            type="button"
                            onClick={() => setPreview(a)}
                            className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                          >
                            {a.name}
                          </button>

                          {/* 파일 크기 */}
                          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                            {formatFileSize(a.sizeBytes)}
                          </span>

                          {/* 다운로드(호버) — downloadUrl 사용 */}
                          <button
                            type="button"
                            onClick={() => void driveApi.downloadByPath(a.downloadUrl, a.name)}
                            data-testid={`drive-attachment-download-${a.fileId}`}
                            className="hidden shrink-0 text-xs text-primary group-hover:inline-flex"
                          >
                            다운로드
                          </button>

                          {/* 저장(드라이브 import) */}
                          <button
                            type="button"
                            data-testid={`drive-attachment-save-${a.fileId}`}
                            disabled={!spacesResolved || personalSpaceId === null}
                            title={
                              spacesResolved && personalSpaceId === null
                                ? '드라이브를 사용할 수 없습니다'
                                : undefined
                            }
                            onClick={() => {
                              if (personalSpaceId === null) return
                              setImporting(a)
                            }}
                            className="shrink-0 rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                          >
                            저장
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 더 보기 — cursor 페이징 */}
        {query.hasNextPage && (
          <div className="flex justify-center py-3">
            <button
              type="button"
              onClick={() => void query.fetchNextPage()}
              className="text-sm text-muted-foreground hover:underline"
            >
              더 보기
            </button>
          </div>
        )}
      </div>

      {/* 폴더 선택 모달 — 저장 버튼 클릭 시 열림 */}
      {importing && personalSpaceId !== null && (
        <FolderPickerModal
          spaceId={personalSpaceId}
          title="저장할 폴더 선택"
          mode="folder"
          onConfirm={(folderId) => {
            importMut.mutate({ spaceId: personalSpaceId, folderId, fileId: importing.fileId })
            setImporting(null)
          }}
          onClose={() => setImporting(null)}
        />
      )}

      {/* 첨부 미리보기 모달 — FilePreviewModal 첨부 분기 */}
      {preview && <FilePreviewModal attachment={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
