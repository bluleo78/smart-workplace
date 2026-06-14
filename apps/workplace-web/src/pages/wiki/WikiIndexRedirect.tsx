import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { useWikiSpaces } from '../../hooks/queries/useWikiSpaces'

/** /wiki 진입 시 첫 스페이스(개인 위키)로 리다이렉트. */
export function WikiIndexRedirect() {
  const { data: spaces, isLoading } = useWikiSpaces()
  const navigate = useNavigate()

  useEffect(() => {
    if (spaces && spaces.length > 0) {
      navigate(`/wiki/spaces/${spaces[0].id}`, { replace: true })
    }
  }, [spaces, navigate])

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
  return <div className="p-6 text-sm text-muted-foreground">위키 공간을 준비 중…</div>
}
