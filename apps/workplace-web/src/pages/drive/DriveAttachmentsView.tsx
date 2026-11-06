// #80: 드라이브 가상 첨부 뷰 — 이슈/이슈챗/메시지/노트에서 업로드된 파일과 내 메일 첨부를 출처별로 묶어 표시.
// 출처 필터(전체/이슈/이슈챗/메시지/노트/메일 — WP-1391 이슈챗, WP-1392 노트·메일 추가) + 이름 검색 + 행별 "저장"(내 드라이브 임포트) 지원.

import { ChevronDown, Paperclip } from 'lucide-react'
import { useMemo, useState } from 'react'

import { driveApi } from '@/api/drive'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { DriveThumbnail } from '@/components/drive/DriveThumbnail'
import { FileTypeIcon } from '@/components/drive/FileTypeIcon'
import { Page, pageGutterClass } from '@/components/layout/Page'
import { Button } from '@/components/ui/button'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { SearchInput } from '@/components/ui/search-input'
import { AttachmentViewer } from '@/components/viewer/AttachmentViewer'
import { useImportToDrive } from '@/components/viewer/useImportToDrive'
import { useViewerBundle } from '@/components/viewer/useViewerBundle'
import {
  normalizeAttachmentPreviewKey,
  virtualAttachmentImportTarget,
  virtualAttachmentItem,
  virtualAttachmentViewerKey,
} from '@/components/viewer/viewerItems'
import { ViewerNotFound } from '@/components/viewer/ViewerNotFound'
import { useDriveAttachments } from '@/hooks/queries/useDriveAttachments'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { useIsMobile } from '@/hooks/useIsMobile'
import { mimeToCategory } from '@/lib/fileCategory'
import { formatFileSize } from '@/lib/formatters'
import { LABEL_COLORS } from '@/lib/labelColors'
import { TOGGLE_ON_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'
import type { VirtualAttachment, VirtualAttachmentSource } from '@/types/drive'

import { groupAttachments } from './groupAttachments'

type SourceFilter = 'ALL' | VirtualAttachmentSource

/** 필터칩 순서 — 이슈챗은 이슈에 딸린 대화라 이슈와 메시지 사이에 둔다(WP-1391 시안). 노트·메일은 그 뒤(WP-1392 시안). */
const SOURCE_FILTERS = ['ALL', 'ISSUE', 'CHAT_MESSAGE', 'MESSAGE', 'WIKI', 'MAIL'] as const satisfies readonly SourceFilter[]

/** 열린 첨부가 속한 그룹이 없을 때의 빈 목록 — 매 렌더 같은 배열이라 묶음 변환 memo 가 깨지지 않는다. */
const NO_ATTACHMENTS: VirtualAttachment[] = []

const SOURCE_LABELS: Record<SourceFilter, string> = {
  ALL: '전체',
  ISSUE: '이슈',
  CHAT_MESSAGE: '이슈챗',
  MESSAGE: '메시지',
  WIKI: '노트',
  MAIL: '메일',
}

/**
 * 그룹 머리 배지 색 — 출처마다 다른 색이라 섞여 있어도 한눈에 구분된다(이슈챗은 이슈·메시지와 겹치지 않는 INDIGO,
 * 노트는 GREEN·메일은 ORANGE — WP-1392 시안).
 */
const SOURCE_BADGE_CLASS: Record<VirtualAttachmentSource, string> = {
  ISSUE: `${LABEL_COLORS.PURPLE.bg} ${LABEL_COLORS.PURPLE.text}`,
  CHAT_MESSAGE: `${LABEL_COLORS.INDIGO.bg} ${LABEL_COLORS.INDIGO.text}`,
  MESSAGE: `${LABEL_COLORS.CYAN.bg} ${LABEL_COLORS.CYAN.text}`,
  WIKI: `${LABEL_COLORS.GREEN.bg} ${LABEL_COLORS.GREEN.text}`,
  MAIL: `${LABEL_COLORS.ORANGE.bg} ${LABEL_COLORS.ORANGE.text}`,
}

/**
 * 행 식별자 — 출처 안의 id(파일이면 fileId, 메일이면 mailAttachmentId). 메일 첨부 id 는 다른 출처의 fileId 와 같은 숫자일 수 있어
 * React key 는 출처까지 붙이고(rowKey), 테스트 id 는 메일만 `mail-` 접두어를 붙여 기존 파일 행 id(`…-row-{fileId}`)를 그대로 둔다(WP-1392).
 */
const rowId = (a: VirtualAttachment) => (a.fileId != null ? String(a.fileId) : `mail-${a.mailAttachmentId}`)
const rowKey = (a: VirtualAttachment) => `${a.sourceType}-${virtualAttachmentViewerKey(a)}`

/** 이슈/이슈챗/메시지/노트/메일 가상 첨부 뷰 — 출처 필터칩 + 이름 검색 + 행별 드라이브 저장. */
export function DriveAttachmentsView() {
  const [source, setSource] = useState<SourceFilter>('ALL')
  const [q, setQ] = useState('')
  const query = useDriveAttachments({ source, q })
  // 본문 스크롤 요소 — 무한 스크롤 sentinel 의 root(WP-182). 콜백 ref 라 마운트 후 재부착된다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  // 가져오기(개인 공간 조회 → 폴더 선택 → 임포트)는 통합 뷰어와 같은 훅을 쓴다 — 공간 조회는 저장을 누를 때 한다(WP-1400).
  const importer = useImportToDrive()

  // 미리보기 = URL ?preview=file:<fileId>(메일 첨부는 mail:<id>)(시스템 뒤로가기로 닫힘, WP-208). 필터 변경·재조회로 목록에서 빠져도 열린 뷰어가
  // 사라지지 않게 마지막으로 본 첨부를 기억한다(useViewerBundle).
  const previewParam = useHistoryParam('preview')
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
  // 묶음 키 → 그룹 표 — groups 가 바뀔 때만 한 번 만든다(렌더마다 모든 첨부의 ViewerItem 을 만들어 키를 비교하지 않게).
  const groupByKey = useMemo(() => {
    const map = new Map<string, (typeof groups)[number]>()
    for (const g of groups) for (const a of g.items) map.set(virtualAttachmentViewerKey(a), g)
    return map
  }, [groups])
  // 열린 첨부 해석 — 현재 목록의 그룹 → 스냅숏 1건 순(단건 조회 API 없음, 필터 변경으로 빠져도 유지).
  // not-found 는 끝 페이지까지 받은 뒤에만 판정한다 — 아직 안 받은 페이지에 있을 수 있는 딥링크를 잘못 "없음"으로 안내하지 않게.
  // 예전 숫자 딥링크(?preview=123)도 file:123 으로 읽는다.
  const previewKey = normalizeAttachmentPreviewKey(previewParam.value)
  const viewer = useViewerBundle({
    list: (previewKey != null ? groupByKey.get(previewKey)?.items : undefined) ?? NO_ATTACHMENTS,
    toItem: virtualAttachmentItem,
    currentKey: previewKey,
    // 조회 실패도 판정 완료로 본다 — 실패 시 뷰어도 안내도 없이 낡은 ?preview 만 남지 않게.
    ready: (query.isSuccess && !query.hasNextPage) || query.isError,
    openKey: previewParam.open,
  })
  const isLoading = query.isLoading
  // 모바일은 헤더 바 없이(Page.Header mobile="hidden") 필터 줄 맨 앞에 검색을 두던 기존 모양 그대로.
  const isMobile = useIsMobile()
  // 검색은 데스크톱에서도 헤더가 아닌 필터 줄에 둔다 — AI 옆 패널이 열리면 칩이 콘텐츠 오른쪽 끝(헤더 우측 액션 자리)으로
  // 밀려 헤더 검색을 가렸다. 헤더 아래 줄은 칩(top-2, 높이 32px)이 닿지 않는다. 데스크톱은 필터칩 뒤 오른쪽 끝(ml-auto).
  // 모바일은 칩 줄(가로 스크롤)이 나머지 폭을 쓰도록 검색 폭을 고정한다 — flex-1 이면 칩 6개(WP-1392)에 밀려 검색이 0 폭으로 눌린다.
  const search = (
    <SearchInput
      value={q}
      onChange={setQ}
      placeholder="파일 이름 검색…"
      aria-label="파일 이름 검색"
      className={isMobile ? 'w-36 flex-none' : 'ml-auto'}
    />
  )

  return (
    <Page data-testid="drive-attachments-view">
      <Page.Header title="첨부 모아보기" mobile="hidden" />
      {/* 세는 기준 안내(WP-1391) — 여기 목록은 「내가 볼 수 있는 곳의 첨부 + 내 메일 첨부」라 사이드바 저장 공간(테넌트 전체 사용량)과
          숫자가 맞지 않는다. 둘을 비교해 헷갈리지 않도록 머리 바로 아래 한 줄로 알린다(WP-1392 에서 노트·메일 출처 반영). */}
      <p
        data-testid="drive-attachments-description"
        className={cn('shrink-0 pt-2 text-xs text-muted-foreground', pageGutterClass)}
      >
        내가 볼 수 있는 이슈·이슈챗·채팅·노트의 첨부와 내 메일의 첨부입니다 — 저장 공간 사용량과 세는 기준이 다릅니다.
      </p>
      {/* 출처 필터칩 + 검색 — 헤더 아래 본문 첫 줄. 목록을 스크롤해도 남도록 스크롤 영역 밖에 둔다.
          칩은 6개(WP-1392)라 좁은 폭에서 넘치면 줄바꿈·잘림 대신 칩 줄만 가로로 스크롤한다(칩은 줄지 않게 shrink-0, 스크롤바는 숨김). */}
      <div className={cn('flex shrink-0 items-center gap-2 border-b py-2', pageGutterClass)}>
        {isMobile && search}
        <div
          data-testid="drive-attachment-filters"
          className={cn('flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', isMobile && 'flex-1')}
        >
          {SOURCE_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              data-testid={`drive-attachment-filter-${s.toLowerCase()}`}
              aria-pressed={source === s}
              className={cn(
                'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                source === s ? TOGGLE_ON_CLASS : 'border-border text-muted-foreground hover:bg-accent/50',
              )}
            >
              {SOURCE_LABELS[s]}
            </button>
          ))}
        </div>
        {!isMobile && search}
      </div>

      {/* 본문 — 로딩/빈상태/목록. 그룹 띠(배경·구분선)가 끝까지 닿도록 본문 여백을 비우고 행이 pageGutterClass 를 갖는다.
          스크롤 요소는 무한 스크롤 sentinel 의 root(scrollRef). */}
      <Page.Body scrollRef={setScrollEl} inset={false}>
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            불러오는 중…
          </div>
        ) : items.length === 0 ? (
          <ChatEmptyState
            icon={<Paperclip className="h-10 w-10" />}
            title="첨부가 없어요"
            description="볼 수 있는 이슈·이슈챗·채팅·노트의 첨부와 내 메일의 첨부가 여기에 모입니다"
          />
        ) : (
          <div>
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.key)
              return (
                <div key={g.key} data-testid="drive-attachment-group" data-group-key={g.key}>
                  {/* 그룹 헤더 — 셰브론(토글) + 유형 배지 + 출처 라벨(딥링크) */}
                  <div className={cn('flex items-center gap-2 border-b bg-muted/30 py-1.5', pageGutterClass)}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.key)}
                      // 묶음 이름을 앞에 붙여 어느 묶음의 버튼인지 구분한다(WP-940).
                      aria-label={`${g.sourceLabel} 묶음 ${isCollapsed ? '펼치기' : '접기'}`}
                      aria-expanded={!isCollapsed}
                      data-testid="drive-attachment-group-toggle"
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
                    >
                      <ChevronDown
                        className={cn('h-4 w-4 transition-transform', isCollapsed && '-rotate-90')}
                      />
                    </button>
                    <span
                      data-testid="drive-attachment-group-badge"
                      className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', SOURCE_BADGE_CLASS[g.sourceType])}
                    >
                      {SOURCE_LABELS[g.sourceType]}
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
                      {g.items.map((a) => {
                        const id = rowId(a)
                        // 썸네일은 core 파일(fileId 있음)에만 — 메일 첨부는 형식 아이콘으로 대신한다.
                        const { fileId } = a
                        // 저장 대상 — 업로드 첨부는 core fileId, 메일 첨부는 메일 첨부 id(WP-1400). 둘 다 없는 비정상 행만 null.
                        const importTarget = virtualAttachmentImportTarget(a)
                        return (
                          <li
                            key={rowKey(a)}
                            data-testid={`drive-attachment-row-${id}`}
                            className={cn('group flex items-center gap-3 py-2 pl-10 text-sm hover:bg-accent/40', pageGutterClass)}
                          >
                            {/* 메일 첨부는 core 파일이 아니라 썸네일이 없다 — 형식 아이콘만(WP-1392). */}
                            {fileId != null ? (
                              <DriveThumbnail fileId={fileId} category={mimeToCategory(a.mimeType)} mimeType={a.mimeType} />
                            ) : (
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center" data-testid="drive-attachment-type-icon">
                                <FileTypeIcon mimeType={a.mimeType} className="h-8 w-8 p-1" />
                              </span>
                            )}

                            {/* 파일명 — 클릭 시 미리보기. 이슈 본문 이미지는 「· 본문」을 붙여 업로드 첨부와 구분한다(WP-1392 시안). */}
                            <div className="flex min-w-0 flex-1 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => viewer.open(a)}
                                className="min-w-0 truncate text-left font-medium hover:underline"
                              >
                                {a.name}
                              </button>
                              {a.kind === 'BODY_IMAGE' && (
                                <span data-testid="drive-attachment-body-image" className="shrink-0 text-xs text-muted-foreground">
                                  · 본문
                                </span>
                              )}
                            </div>

                            {/* 파일 크기 */}
                            <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                              {formatFileSize(a.sizeBytes)}
                            </span>

                            {/* 다운로드(호버·키보드 포커스) — downloadUrl 사용(메일 첨부도 서버가 준 메일 첨부 경로). display:none 이면 Tab 순서에서
                                빠지므로 투명도로 감춘다(WP-498). 터치 기기는 예전처럼 감춘다(행 눌러 미리보기에서 받는다). */}
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => void driveApi.downloadByPath(a.downloadUrl, a.name)}
                              data-testid={`drive-attachment-download-${id}`}
                              className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:hidden"
                            >
                              다운로드
                            </Button>

                            {/* 내 드라이브에 저장 — 업로드 첨부는 가져오기, 메일 첨부는 메일 첨부 저장(WP-1400)으로 같은 폴더 선택 흐름을 탄다.
                                다운로드(로컬)와 구분되는 라벨. */}
                            {importTarget != null && (
                              <Button
                                variant="outline"
                                size="xs"
                                data-testid={`drive-attachment-save-${id}`}
                                disabled={importer.busy}
                                onClick={() => importer.begin(importTarget)}
                                className="shrink-0"
                              >
                                내 드라이브에 저장
                              </Button>
                            )}
                            {/* 저장 대상이 없는 행(id 가 빠진 메일 행 등)도 같은 폭의 빈 자리를 둬 크기·다운로드 열이 다른 행과 줄 맞게 한다 —
                                보이지 않고(invisible) 보조 기술·Tab 에서도 빠진다(WP-1392 라이브 확인에서 크기 열이 오른쪽으로 밀림). */}
                            {importTarget == null && (
                              <Button
                                variant="outline"
                                size="xs"
                                aria-hidden
                                tabIndex={-1}
                                disabled
                                data-testid={`drive-attachment-save-spacer-${id}`}
                                className="invisible shrink-0"
                              >
                                내 드라이브에 저장
                              </Button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 다음 묶음 — cursor 페이징. WP-182: 끝에 닿으면 자동 로드, 실패했을 때만 다시 시도 버튼 */}
        <LoadMoreFooter query={query} root={scrollEl} data-testid="drive-attachments-more" />
      </Page.Body>

      {/* 폴더 선택 모달 — 저장 버튼 클릭 시 열림 */}
      {importer.picker}

      {/* 통합 첨부 뷰어 — 같은 출처 그룹 단위로 넘긴다. 키 = file:{fileId}(메일 첨부는 mail:{id}). */}
      {viewer.bundle && (
        <AttachmentViewer
          items={viewer.bundle.items}
          index={viewer.bundle.index}
          onIndexChange={viewer.onIndexChange}
          onClose={previewParam.close}
        />
      )}
      {/* 삭제됐거나 볼 수 없게 된 첨부 딥링크 — 드라이브와 같은 안내 후 닫으면 ?preview 를 지운다. */}
      {viewer.missing && <ViewerNotFound onClose={previewParam.close} description="삭제되었거나 더 이상 볼 수 없는 첨부입니다." />}
    </Page>
  )
}
