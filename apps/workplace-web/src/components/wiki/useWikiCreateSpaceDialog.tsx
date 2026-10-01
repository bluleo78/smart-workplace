import axios from 'axios'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { extractApiError, handleApiError } from '@/lib/api-error'

import { useCreateSpace } from '../../hooks/queries/useWikiMutations'
import { WikiCreateSpaceDialog } from './WikiCreateSpaceDialog'

/**
 * 노트 스페이스 생성 흐름(다이얼로그 + 생성 mutation + 성공 시 새 스페이스로 이동)을 묶은 훅.
 * 사이드바 스페이스 선택 상자의 "＋ 새 스페이스"와 공간 0개 빈 상태의 [공간 만들기](WP-143)가 같은 흐름을 쓴다.
 * 반환한 dialog 를 호출부 JSX 안에 렌더하고, openCreateSpace 로 연다.
 */
export function useWikiCreateSpaceDialog() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  // 이름 중복(409) 인라인 에러 — 컨테이너류 이름 하드 차단 정책(#688/#696/#803).
  const [error, setError] = useState<string | null>(null)
  const createSpace = useCreateSpace()

  // 새 스페이스 생성 → 목록 무효화(훅) 후 새 스페이스로 이동. 이름 중복(409)은 다이얼로그에
  // 인라인 에러로도 노출(토스트만으로는 어느 필드가 문제인지 불명확) — 다른 실패는 토스트만.
  const handleCreate = (name: string) => {
    setError(null)
    createSpace.mutate(name, {
      onSuccess: (space) => {
        setOpen(false)
        navigate(`/wiki/spaces/${space.id}`)
      },
      onError: (e) => {
        const message = extractApiError(e, '')
        if (axios.isAxiosError(e) && e.response?.status === 409 && message.startsWith('이미 존재하는 스페이스 이름입니다')) {
          setError(message)
        }
        handleApiError(e, '스페이스 생성에 실패했습니다.')
      },
    })
  }

  const dialog = (
    <WikiCreateSpaceDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
      onCreate={handleCreate}
      pending={createSpace.isPending}
      error={error}
    />
  )

  return { openCreateSpace: () => setOpen(true), dialog }
}
