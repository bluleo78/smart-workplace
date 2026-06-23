import { ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

import { DrivePage } from '../../pages/drive/DrivePage'

/**
 * 채널/대화 파일을 대화 컨텍스트 안에서 보는 오버레이 드로워.
 * 드라이브 엔진(DrivePage)을 임베드 모드로 재사용한다 — 폴더 탐색은 state 백엔드라
 * 상위 페이지 URL 을 오염시키지 않는다. 폭이 부족한 작업은 "전체에서 열기"로 풀페이지에 넘긴다.
 * spaceId === null 이면 닫힘.
 */
export function DriveSpaceDrawer({
  spaceId,
  title,
  onClose,
}: {
  spaceId: number | null
  title: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  return (
    <Sheet open={spaceId != null} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[32rem]"
        data-testid="drive-space-drawer"
      >
        <SheetHeader className="shrink-0 flex-row items-center justify-between space-y-0 border-b px-4 py-3">
          {/* 스크린 리더용 드로워 설명 — Radix Dialog description 부재 경고 해소 (#361 패턴) */}
          <SheetDescription className="sr-only">파일 목록</SheetDescription>
          <SheetTitle className="truncate text-sm">
            <span className="text-muted-foreground">{title}</span>
            <span className="mx-1 text-muted-foreground">/</span>
            파일
          </SheetTitle>
          {spaceId != null && (
            <button
              type="button"
              data-testid="drive-drawer-open-full"
              onClick={() => { onClose(); navigate(`/drive/spaces/${spaceId}`) }}
              className="mr-6 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              전체에서 열기
            </button>
          )}
        </SheetHeader>
        {/* 드라이브 엔진 임베드 — 자체 헤더(검색/업로드)와 본문을 그대로 렌더. */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {spaceId != null && <DrivePage spaceId={spaceId} />}
        </div>
      </SheetContent>
    </Sheet>
  )
}
