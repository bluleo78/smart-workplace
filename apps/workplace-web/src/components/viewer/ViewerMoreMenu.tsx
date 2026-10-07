import { MoreHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { copyText } from '../../lib/copyText'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { resolveDriveOpenPath } from './driveOpen'
import type { ViewerItem } from './types'

/**
 * 뷰어 헤더 ⋯ 메뉴(WP-277) — 항목 필드 유무로 항목을 구성한다(화면별 분기 없음).
 * 원본으로 이동·링크 복사(공유 가능한 호출부만)·드라이브로 가져오기·드라이브에서 열기.
 * 가져오기는 헤더 ☁ 와 같은 핸들러를 부모가 내려 준다(onImport). 항목이 하나도 없으면 ⋯ 자체를 그리지 않는다.
 */
export function ViewerMoreMenu({
  item,
  onImport,
  shareable = true,
}: {
  item: ViewerItem
  /** 있으면 "드라이브로 가져오기" 항목을 보인다(item.importFileId 가 있고 가져오기가 가능할 때). */
  onImport?: () => void
  /** URL 로 다시 열 수 있는 뷰어인지 — false 면 "링크 복사"를 숨긴다(복사해도 같은 화면이 열리지 않으므로). */
  shareable?: boolean
}) {
  const navigate = useNavigate()
  // 빈 메뉴(⋯ 를 눌러도 아무것도 없음)는 그리지 않는다.
  if (!item.sourceLink && !shareable && !onImport && !item.driveOpen) return null
  // 현재 URL 에 ?preview= 가 있어 그대로 공유하면 같은 뷰어가 열린다.
  // copyText 는 Clipboard API 가 없거나 거부돼도(사내망 http 등) execCommand 로 한 번 더 시도하고 성공 여부만 돌려준다.
  const copyLink = () => {
    void copyText(window.location.href).then((ok) =>
      ok ? toast.success('링크를 복사했습니다') : toast.error('링크를 복사하지 못했습니다'),
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="더 보기">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      {/* 메뉴는 body 로 포털되어 뷰어 루트의 .dark 밖에 그려진다 — 같은 다크 토큰을 쓰도록 dark 를 직접 단다. */}
      <DropdownMenuContent align="end" className="dark">
        {item.sourceLink && (
          // 라우트가 바뀌면 뷰어는 호출부 URL 상태와 함께 닫힌다.
          <DropdownMenuItem onSelect={() => navigate(item.sourceLink!)}>원본으로 이동</DropdownMenuItem>
        )}
        {shareable && <DropdownMenuItem onSelect={copyLink}>링크 복사</DropdownMenuItem>}
        {onImport && <DropdownMenuItem onSelect={onImport}>드라이브로 가져오기</DropdownMenuItem>}
        {item.driveOpen && (
          // 파일이 있는 폴더를 찾아 연다 — 공간 루트로만 열면 하위 폴더 파일이 "찾을 수 없음"이 된다.
          <DropdownMenuItem onSelect={() => void resolveDriveOpenPath(item.driveOpen!).then((to) => navigate(to))}>
            드라이브에서 열기
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
