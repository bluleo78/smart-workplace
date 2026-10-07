import { MoreHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import type { ViewerItem } from './types'

/**
 * 뷰어 헤더 ⋯ 메뉴(WP-277) — 항목 필드 유무로 항목을 구성한다(화면별 분기 없음).
 * 원본으로 이동·링크 복사(항상)·드라이브로 가져오기·드라이브에서 열기.
 * 가져오기는 헤더 ☁ 와 같은 핸들러를 부모가 내려 준다(onImport).
 */
export function ViewerMoreMenu({
  item,
  onImport,
}: {
  item: ViewerItem
  /** 있으면 "드라이브로 가져오기" 항목을 보인다(item.importFileId 가 있고 가져오기가 가능할 때). */
  onImport?: () => void
}) {
  const navigate = useNavigate()
  // 현재 URL 에 ?preview= 가 있어 그대로 공유하면 같은 뷰어가 열린다.
  const copyLink = () => {
    void navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast.success('링크를 복사했습니다'))
      .catch(() => toast.error('링크를 복사하지 못했습니다'))
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="더 보기">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {item.sourceLink && (
          // 라우트가 바뀌면 뷰어는 호출부 URL 상태와 함께 닫힌다.
          <DropdownMenuItem onSelect={() => navigate(item.sourceLink!)}>원본으로 이동</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={copyLink}>링크 복사</DropdownMenuItem>
        {onImport && <DropdownMenuItem onSelect={onImport}>드라이브로 가져오기</DropdownMenuItem>}
        {item.driveOpenPath && (
          <DropdownMenuItem onSelect={() => navigate(item.driveOpenPath!)}>드라이브에서 열기</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
