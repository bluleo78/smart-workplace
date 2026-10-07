import type { ReactNode } from 'react'
import { createElement, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useDriveSpaces } from '../../hooks/queries/useDriveSpaces'
import { useImportAttachment } from '../../hooks/queries/useImportAttachment'
import { FolderPickerModal } from '../drive/FolderPickerModal'

/**
 * "드라이브로 가져오기" 공용 흐름(WP-277) — 개인 공간 조회 → 폴더 선택 모달 → 임포트.
 * 첨부 모아보기(DriveAttachmentsView)와 통합 뷰어(☁·⋯)가 같은 흐름을 쓰도록 한 곳에 둔다.
 * - enabled=false 면 공간 조회를 하지 않는다(가져오기 대상이 없는 항목에서 불필요한 요청 방지).
 * - picker 는 호출부가 원하는 위치(뷰어 Dialog 안 등)에 그린다 — 포커스 트랩 안에 두기 위해.
 */
export function useImportToDrive(enabled = true) {
  const spaces = useDriveSpaces({ enabled })
  const importMut = useImportAttachment()
  const [fileId, setFileId] = useState<number | null>(null)
  const personalSpaceId = spaces.data?.find((s) => s.type === 'PERSONAL')?.id ?? null
  // 조회 완료 = 성공이거나 실패 — 로딩 중 비활성과 조회 실패 비활성을 구분하는 데 쓴다.
  const resolved = !enabled || spaces.isSuccess || spaces.isError

  // 실패 토스트는 한 번만 — 재조회로 isError 가 다시 뒤집혀도 반복하지 않는다.
  const toasted = useRef(false)
  useEffect(() => {
    if (spaces.isError && !toasted.current) {
      toasted.current = true
      toast.error('드라이브 스페이스를 불러오지 못했습니다.')
    }
  }, [spaces.isError])

  const picker: ReactNode =
    fileId != null && personalSpaceId != null
      ? createElement(FolderPickerModal, {
          spaceId: personalSpaceId,
          title: '저장할 폴더 선택',
          mode: 'folder',
          onConfirm: (folderId: number | null) => {
            importMut.mutate({ spaceId: personalSpaceId, folderId, fileId })
            setFileId(null)
          },
          onClose: () => setFileId(null),
        })
      : null

  return {
    /** 개인 공간이 확인돼 가져오기를 시작할 수 있다. */
    ready: personalSpaceId != null,
    /** 공간 조회가 끝났는데 개인 공간이 없다(권한 없음·조회 실패). */
    unavailable: resolved && personalSpaceId == null,
    /** 폴더 선택 모달을 연다. */
    begin: (id: number) => {
      if (personalSpaceId != null) setFileId(id)
    },
    picker,
  }
}
