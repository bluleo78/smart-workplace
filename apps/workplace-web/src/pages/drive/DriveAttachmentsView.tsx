// #80: 드라이브 가상 첨부 뷰 — 이슈/메시지에서 업로드된 파일을 시간순 플랫 리스트로 표시.
// 출처 필터(전체/이슈/메시지) + 이름 검색 + 행별 "저장"(내 드라이브 임포트) 지원.

import { ChevronDown, Paperclip } from 'lucide-react'
import { useMemo, useState } from 'react'

import { driveApi } from '@/api/drive'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { DriveThumbnail } from '@/components/drive/DriveThumbnail'
import { Button } from '@/components/ui/button'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { SearchInput } from '@/components/ui/search-input'
import { AttachmentViewer } from '@/components/viewer/AttachmentViewer'
import { useImportToDrive } from '@/components/viewer/useImportToDrive'
import { resolveBundle, virtualAttachmentItem } from '@/components/viewer/viewerItems'
import { useDriveAttachments } from '@/hooks/queries/useDriveAttachments'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { mimeToCategory } from '@/lib/fileCategory'
import { formatFileSize } from '@/lib/formatters'
import { LABEL_COLORS } from '@/lib/labelColors'
import { cn } from '@/lib/utils'
import type { VirtualAttachment } from '@/types/drive'

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
  // 본문 스크롤 요소 — 무한 스크롤 sentinel 의 root(WP-182). 콜백 ref 라 마운트 후 재부착된다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  // 가져오기(개인 공간 조회 → 폴더 선택 → 임포트)는 통합 뷰어와 같은 훅을 쓴다.
  const importer = useImportToDrive()

  // 미리보기 = URL ?preview=file:<fileId>(시스템 뒤로가기로 닫힘, WP-208). 필터 변경·재조회로 목록에서 빠져도 열린 모달이
  // 사라지지 않게 클릭한 첨부를 기억한다.
  const previewParam = useHistoryParam('preview')
  const [previewSnap, setPreviewSnap] = useState<VirtualAttachment | null>(null)
  // 접힌 그룹 key 집합(기본 모두 펼침). 세션 임시 — localStorage 미사용.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // 페이지 데이터가 같으면 같은 배열 — 아래 그룹 계산 memo 가 렌더마다 깨지지 않게 한다.
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  // 묶음 = 클릭한 첨부가 속한 출처 그룹(같은 이슈·같은 메시지) — ‹ › 는 같은 묶음 안에서만 움직인다.
  const groups = useMemo(() => groupAttachments(items), [items])
  const groupOf = (key: string | null) =>
    groups.find((g) => g.items.some((a) => `file:${a.fileId}` === key))
  // 열린 첨부 해석 — 현재 목록의 그룹 → 클릭 스냅숏 1건 순(단건 조회 API 없음, 필터 변경으로 빠져도 유지).
  const bundle = resolveBundle(
    (groupOf(previewParam.value)?.items ?? []).map(virtualAttachmentItem),
    previewParam.value,
    previewSnap ? virtualAttachmentItem(previewSnap) : null,
  )
  const isLoading = query.isLoading

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="drive-attachments-view">
      {/* 상단 바 — 검색 + 출처 필터칩.
          lg:pt-12: 전역 AIChip(fixed left-1/2 top-2, 높이 32px, bottom≈40px)이 데스크톱(lg+)에서
          AppLayout main 의 pt-0 로 인해 콘텐츠 최상단과 그대로 겹친다(#576). 모바일은 AppLayout 이
          이미 pt-12 를 둬 안전하므로(main lg:pt-0 대비 breakpoint 일치), lg 에서만 동일한 48px 여백을
          더해 칩 아래로 필터 바를 내린다. */}
      <div className="flex items-center gap-2 border-b px-4 py-2 lg:pt-12">
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
      <div ref={setScrollEl} className="flex-1 overflow-y-auto">
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
            {groups.map((g) => {
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
                            onClick={() => { setPreviewSnap(a); previewParam.open(`file:${a.fileId}`) }}
                            className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                          >
                            {a.name}
                          </button>

                          {/* 파일 크기 */}
                          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                            {formatFileSize(a.sizeBytes)}
                          </span>

                          {/* 다운로드(호버) — downloadUrl 사용 */}
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => void driveApi.downloadByPath(a.downloadUrl, a.name)}
                            data-testid={`drive-attachment-download-${a.fileId}`}
                            className="hidden shrink-0 group-hover:inline-flex"
                          >
                            다운로드
                          </Button>

                          {/* 내 드라이브에 저장(import) — 항상 표시. 다운로드(로컬)와 구분되는 라벨. */}
                          <Button
                            variant="outline"
                            size="xs"
                            data-testid={`drive-attachment-save-${a.fileId}`}
                            disabled={!importer.ready}
                            title={importer.unavailable ? '드라이브를 사용할 수 없습니다' : undefined}
                            onClick={() => importer.begin(a.fileId)}
                            className="shrink-0"
                          >
                            내 드라이브에 저장
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 다음 묶음 — cursor 페이징. WP-182: 끝에 닿으면 자동 로드, 실패했을 때만 다시 시도 버튼 */}
        <LoadMoreFooter query={query} root={scrollEl} data-testid="drive-attachments-more" />
      </div>

      {/* 폴더 선택 모달 — 저장 버튼 클릭 시 열림 */}
      {importer.picker}

      {/* 통합 첨부 뷰어 — 같은 출처 그룹 단위로 넘긴다. 키 = file:{fileId}. */}
      {bundle && (
        <AttachmentViewer
          items={bundle.items}
          index={bundle.index}
          onIndexChange={(i) => {
            const target = bundle.items[i]
            if (!target) return // 목록이 줄어 범위를 벗어난 요청은 무시
            // 넘긴 첨부도 스냅숏으로 갱신 — 이후 필터 변경·재조회로 목록에서 빠져도 열린 뷰어가 유지된다.
            const a = items.find((x) => `file:${x.fileId}` === target.key)
            if (a) setPreviewSnap(a)
            previewParam.open(target.key)
          }}
          onClose={previewParam.close}
        />
      )}
    </div>
  )
}
