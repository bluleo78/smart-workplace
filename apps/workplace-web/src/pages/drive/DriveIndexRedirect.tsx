import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { driveApi } from '../../api/drive'

/** /drive 진입 시 개인 공간(없으면 첫 공간)으로 리다이렉트. */
export function DriveIndexRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    void driveApi.listSpaces().then(({ data }) => {
      const personal = data.find((s) => s.type === 'PERSONAL') ?? data[0]
      if (personal) navigate(`/drive/spaces/${personal.id}`, { replace: true })
    })
  }, [navigate])
  return null
}
