import { ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { MobileDetailCtx } from '@/components/mobile/MobileDetailContext'
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
 * 드라이브 엔진(DrivePage)을 임베드 모드로 재사용한다 — 폴더 탐색은 `?filesFolder`(드라이브 풀페이지 folderId 와 별도 키, push).
 * 열림은 호출부가 URL(`?files=1`)로 소유한다(WP-207). spaceId 는 연동 공간 보장(POST) 결과라 열린 직후 잠시 null 일 수 있다.
 * 폭이 부족한 작업은 "전체에서 열기"로 풀페이지에 넘긴다.
 */
export function DriveSpaceDrawer({
  open,
  spaceId,
  failed,
  title,
  onClose,
}: {
  open: boolean
  spaceId: number | null
  failed: boolean
  title: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
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
              onClick={() =>
                // onClose()(=history.go(-1), 비동기) 뒤에 push 하면 늦게 도착한 go(-1) 이 방금 연 드라이브에서 되돌린다.
                // 그래서 닫지 않고 ?files 항목을 드라이브 풀페이지로 교체한다 — 드라이브에서 back = 채널(WP-207).
                // 알려진 한계: 드로워 안 폴더 깊이>0 이면 현재(가장 깊은) 폴더 항목만 교체되므로, back 은 드로워의
                // 상위 폴더 항목으로 돌아온다(그 아래 폴더 항목들이 남음). go(-n) 후 push 는 같은 경합이 있어 받아들인다.
                navigate(`/drive/spaces/${spaceId}`, { replace: true })
              }
              className="mr-6 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              전체에서 열기
            </button>
          )}
        </SheetHeader>
        {/* 드라이브 엔진 임베드 — 자체 헤더(검색/업로드)와 본문을 그대로 렌더. */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {/* 컨텍스트는 포털을 넘어 전달되므로, 모바일 채널 상세 안에서 연 드로워의 DrivePage 헤더가
              상세 헤더로 등록돼 ‹·✦ 를 그리거나 채널 헤더를 숨기지 않게 병합 컨텍스트를 끊는다. */}
          <MobileDetailCtx.Provider value={null}>
            {spaceId != null ? (
              <DrivePage spaceId={spaceId} />
            ) : failed ? (
              <p data-testid="drive-drawer-error" className="p-4 text-sm text-destructive">파일 공간을 불러오지 못했습니다.</p>
            ) : (
              <p data-testid="drive-drawer-loading" className="p-4 text-sm text-muted-foreground">불러오는 중…</p>
            )}
          </MobileDetailCtx.Provider>
        </div>
      </SheetContent>
    </Sheet>
  )
}
