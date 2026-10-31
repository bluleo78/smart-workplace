import { MoreHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { LinkMenuItems } from '@/components/share/LinkMenuItems'
import { hasLinkMenuItems } from '@/components/share/shareActions'
import type { ShareTarget } from '@/lib/shareTarget'

import { Button } from '../ui/button'
import { resolveDriveOpenPath } from './driveOpen'
import type { ViewerItem } from './types'

/** 메뉴 항목 — 터치(coarse)에서 높이 44px(트리거 pointer-coarse:size-11 과 같은 방식). */
const ITEM_CLASS = 'pointer-coarse:min-h-11'

/**
 * 뷰어 헤더 ⋯ 메뉴(WP-277) — 항목 필드 유무로 항목을 구성한다(화면별 분기 없음).
 * 원본으로 이동·드라이브로 가져오기·드라이브에서 열기·브라우저에서 열기(설치된 앱 + 공유 가능한 호출부만).
 * 「링크 복사」는 헤더 🔗(모바일 ⬆︎ 시트)로 옮겼다(WP-1234).
 * 가져오기는 헤더 ☁ 와 같은 핸들러를 부모가 내려 준다(onImport). 항목이 하나도 없으면 ⋯ 자체를 그리지 않는다.
 */
export function ViewerMoreMenu({
  item,
  onImport,
  shareTarget,
}: {
  item: ViewerItem
  /** 있으면 "드라이브로 가져오기" 항목을 보인다(item.importFileId 가 있고 가져오기가 가능할 때). */
  onImport?: () => void
  /** 링크로 다시 열 수 있는 뷰어의 대상(WP-1234) — 있으면 링크 항목(브라우저에서 열기)을 둔다. 없으면(shareable=false) 링크 항목이 없다. */
  shareTarget?: ShareTarget | null
}) {
  const navigate = useNavigate()
  const linkItems = shareTarget != null && hasLinkMenuItems(shareTarget)
  // 빈 메뉴(⋯ 를 눌러도 아무것도 없음)는 그리지 않는다.
  if (!item.sourceLink && !linkItems && !onImport && !item.driveOpen) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="pointer-coarse:size-11" aria-label="더 보기">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      {/* 메뉴는 body 로 포털되어 뷰어 루트의 .dark 밖에 그려진다 — 같은 다크 토큰을 쓰도록 dark 를 직접 단다.
          collisionPadding — 좁은 폭(360px)에서 메뉴가 화면 끝에 붙지 않게 가장자리 8px 를 띄운다.
          터치(coarse)에서는 항목을 44px 로 키운다(바 버튼과 같은 터치 기준). ui/ 기본값은 그대로 두고 뷰어 메뉴에만 준다. */}
      <DropdownMenuContent align="end" collisionPadding={8} className="dark">
        {item.sourceLink && (
          // 라우트가 바뀌면 뷰어는 호출부 URL 상태와 함께 닫힌다.
          <DropdownMenuItem className={ITEM_CLASS} onSelect={() => navigate(item.sourceLink!)}>원본으로 이동</DropdownMenuItem>
        )}
        {linkItems && <LinkMenuItems target={shareTarget} itemClassName={ITEM_CLASS} />}
        {onImport && <DropdownMenuItem className={ITEM_CLASS} onSelect={onImport}>드라이브로 가져오기</DropdownMenuItem>}
        {item.driveOpen && (
          // 파일이 있는 폴더를 찾아 연다 — 공간 루트로만 열면 하위 폴더 파일이 "찾을 수 없음"이 된다.
          <DropdownMenuItem className={ITEM_CLASS} onSelect={() => void resolveDriveOpenPath(item.driveOpen!).then((to) => navigate(to))}>
            드라이브에서 열기
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
