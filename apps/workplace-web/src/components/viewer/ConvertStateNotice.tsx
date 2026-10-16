import { formatFileSize } from '../../lib/formatters'
import { FileTypeIcon } from '../drive/FileTypeIcon'
import { Button } from '../ui/button'
import type { ViewerItem } from './types'

/** 상태 화면 공통 배치 — 미지원 화면(UnsupportedNotice)과 같은 가운데 세로 배치로 상태 화면끼리 생김새를 맞춘다. */
const NOTICE_LAYOUT = 'm-auto flex w-full flex-col items-center gap-3 px-4 py-12 text-center'
// 파일 이름은 break-keep wrap-break-word — 띄어쓰기에서 줄을 바꾸고(확장자 `.h|wp` 처럼 낱자로 쪼개지 않게), 띄어쓰기 없는 긴 이름만 넘칠 때 자른다.

/**
 * 변환 중 안내(WP-431) — 드라이브 HWP·PPT·DOC 를 서버가 PDF 로 바꾸는 동안 스켈레톤 대신 보인다.
 * 진행률(%)은 서버도 모르므로 불확정 막대(aria-valuenow 없음)로 흐름만 보여 준다.
 * 동작 줄이기 설정이면 흐르는 대신 폭 100% 맥박으로 바꾼다(index.css .animate-convert-indeterminate).
 */
export function ConvertingNotice({ item }: { item: ViewerItem }) {
  return (
    <div className={NOTICE_LAYOUT} data-testid="preview-converting">
      <FileTypeIcon mimeType={item.mimeType} className="h-16 w-16" />
      <p className="text-sm font-medium break-keep wrap-break-word">{item.name}</p>
      <p className="text-sm">원래 모양으로 여는 중…</p>
      <div
        role="progressbar"
        aria-label={`${item.name} 여는 중`}
        className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted"
      >
        <div className="animate-convert-indeterminate h-full rounded-full bg-primary" />
      </div>
      <p className="text-xs text-muted-foreground">처음 여는 문서는 몇 초 걸릴 수 있어요</p>
    </div>
  )
}

/**
 * 변환 실패 안내(WP-431, 시안 B).
 * - 영구(transient=false): 파일 자체 문제(손상·너무 큼 등)라 다시 해도 같으므로 다운로드만 준다.
 * - 일시(transient=true): 변환 서비스 지연·폴링 상한 초과 — [다시 시도]를 더해 같은 자리에서 다시 묻게 한다.
 * 다운로드는 늘 원본 파일이다(변환 PDF 를 원본 이름으로 내보내지 않게).
 */
export function ConvertFailedNotice({
  item,
  transient,
  onRetry,
  onDownload,
}: {
  item: ViewerItem
  transient: boolean
  onRetry: () => void
  onDownload: () => void
}) {
  return (
    <div className={NOTICE_LAYOUT} data-testid="preview-convert-failed" data-transient={String(transient)}>
      <FileTypeIcon mimeType={item.mimeType} className="h-16 w-16" />
      <p className="text-sm font-medium break-keep wrap-break-word">{item.name}</p>
      {!transient && item.sizeBytes != null && (
        <p className="text-xs text-muted-foreground">{formatFileSize(item.sizeBytes)}</p>
      )}
      <p className="text-sm text-muted-foreground break-keep">
        {transient ? '지금은 미리보기를 준비하지 못했어요. 잠시 뒤 다시 시도해 주세요' : '이 문서는 미리 볼 수 없어요'}
      </p>
      <div className="flex gap-2">
        {transient && (
          <Button variant="outline" onClick={onRetry}>
            다시 시도
          </Button>
        )}
        <Button variant="outline" onClick={onDownload}>
          다운로드
        </Button>
      </div>
    </div>
  )
}
