// 메일 작성 서식 둘째 줄의 펼침 상태 — 작성창을 새로 열어도(dock·fill·mobile 공통) 이어지도록 localStorage 에 기억한다.
// 저장소가 막혀도 readStored/writeStored 가 탭 한정 메모리로 대신 기억한다.
import { useCallback, useState } from 'react'

import { MAIL_FORMAT_ROW_KEY } from '@/lib/mailFormat'
import { readStored, writeStored } from '@/lib/storageWithFallback'

/** [열림, 바꾸기] — 처음 값은 저장된 '1' 이면 열림, 없으면(처음) 접힘. 바꿀 때마다 '1'/'0' 으로 쓴다. */
export function useMailFormatRowOpen(): [open: boolean, setOpen: (open: boolean) => void] {
  const [open, setOpenState] = useState(() => readStored(MAIL_FORMAT_ROW_KEY) === '1')
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    writeStored(MAIL_FORMAT_ROW_KEY, next ? '1' : '0')
  }, [])
  return [open, setOpen]
}
