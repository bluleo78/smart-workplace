// WP-1730 「완전히 삭제」 메뉴 항목의 공통 표시 — 휴대폰 상세 ⋯ 메뉴(MailPermanentDeleteMenuItem)와 데스크톱 목록 행 우클릭 메뉴(MailRowContextMenu)가 같이 쓴다.
// 왜 따로 두나: 꺼짐 판정·스피너/휴지통 아이콘 바꾸기·짧은 이유 글이 두 메뉴에서 어긋나지 않게 한 곳에서 정한다. 그리는 모양(단추·Radix 항목)은 각자 맡는다.
import { Loader2, Trash2 } from 'lucide-react'
import { type ReactNode, useId } from 'react'

import { PERMANENT_DELETE_UNSUPPORTED_SHORT, type TrashButtonState } from '@/lib/mailTrashActions'

/** 「완전히 삭제」 항목을 그리는 데 필요한 값 묶음. */
export interface PermanentDeleteItemView {
  /** 미지원 서버이거나 처리 중이면 끈다. */
  disabled: boolean
  /** 처리 중이면 스피너, 아니면 휴지통 아이콘. */
  icon: ReactNode
  /** 미지원이면 항목 곁에 보이는 짧은 이유 글(터치·꺼진 메뉴 항목엔 툴팁이 없다), 아니면 null. */
  reason: string | null
  /** 이유 글 요소의 id — 항목의 aria-describedby 로 잇는다(화면 낭독기가 꺼진 항목과 이유를 함께 읽게). */
  reasonId: string
}

/**
 * 「완전히 삭제」 항목의 꺼짐·아이콘·이유 글을 정한다.
 * 아이콘 크기는 그리는 쪽이 감싼 요소에서 맞춘다(Radix 메뉴 항목은 스스로, ⋯ 메뉴 단추는 [&_svg]:size-4).
 */
export function usePermanentDeleteItem(state: TrashButtonState, pending: boolean): PermanentDeleteItemView {
  const reasonId = useId()
  const icon = pending ? <Loader2 aria-hidden className="animate-spin" /> : <Trash2 aria-hidden />
  return {
    disabled: !state.enabled || pending,
    icon,
    reason: state.enabled ? null : PERMANENT_DELETE_UNSUPPORTED_SHORT,
    reasonId,
  }
}
