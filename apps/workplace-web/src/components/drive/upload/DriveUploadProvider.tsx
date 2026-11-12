/**
 * 앱 전역 드라이브 업로드 Provider (WP-1534).
 *
 * 왜 App 루트인가: 업로드 큐·패널을 DrivePage 가 갖고 있으면 다른 메뉴로 이동하는 순간 패널이 사라져
 * 진행 상황을 보거나 취소할 수 없다. 앱 셸 위로 올려 화면을 옮겨 다녀도 큐와 패널이 이어지게 한다.
 *
 * 왜 신원 바뀜에 비우는가: 로그아웃·사용자 전환 뒤에도 이전 사용자의 요청·패널이 남으면
 * 다음 사용자에게 보이거나 다른 토큰으로 계속 올라간다. AuthProvider 가 토큰을 비우거나 바꾸기 직전에 쏘는
 * 신원 바뀜 알림(onIdentityChange)으로 그 자리에서 끊고 비우고, user id 변화 effect 는 뒤늦은 받침으로 둔다.
 *
 * 컨텍스트·타입·훅은 driveUploadContext.ts 에 있다(이 파일은 Provider 컴포넌트만 내보낸다 — react-refresh).
 */
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { driveApi } from '@/api/drive'
import { driveKeys } from '@/hooks/queries/driveKeys'
import { useAuth } from '@/hooks/useAuth'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { onIdentityChange } from '@/lib/auth/identityChange'
import { uploadDriveFile } from '@/lib/drive/chunkedUpload'
import { useDriveUploadQueue } from '@/pages/drive/useDriveUploadQueue'

import {
  type DriveFileUpload,
  type DriveFolderResolve,
  DriveUploadContext,
  DriveUploadFloatingHeightContext,
  type DriveUploadLayoutActions,
  DriveUploadLayoutActionsContext,
  DriveUploadLayoutContext,
  type DriveUploadLayoutValue,
} from './driveUploadContext'

/**
 * 기본 전송(WP-1520) — 20MB 이하는 한 번에, 넘으면 업로드 세션으로 조각을 나눠 이어 올린다.
 * 끊기면 받은 데부터 잇고, 「다시 시도」로 같은 파일을 다시 올려도 이어 간다.
 */
const defaultDriveUpload: DriveFileUpload = (root, folderId, file, signal, onProgress) =>
  uploadDriveFile(root.sid, folderId, file, { signal, onProgress })

/** 기본 폴더 해석 — 부모 아래 이름으로 폴더를 찾거나 만들어 id 를 준다. */
const defaultDriveResolveFolder: DriveFolderResolve = async (root, parentId, name) =>
  (await driveApi.resolveFolder(root.sid, parentId, name)).data.id

export function DriveUploadProvider({
  children,
  upload,
  resolveFolder,
}: {
  children: ReactNode
  upload?: DriveFileUpload
  resolveFolder?: DriveFolderResolve
}) {
  const queryClient = useQueryClient()
  const queue = useDriveUploadQueue({
    upload: upload ?? defaultDriveUpload,
    resolveFolder: resolveFolder ?? defaultDriveResolveFolder,
    // 끝나면(성공이 없어도 — 놓은 폴더는 만들어졌을 수 있다) 배치의 공간 목록·사용량 캐시를 무효화한다.
    onSettled: (root) => {
      void queryClient.invalidateQueries({ queryKey: driveKeys.itemsAll(root.sid) })
      void queryClient.invalidateQueries({ queryKey: driveKeys.quota })
    },
  })

  // queue.close 는 deps 가 안정인 useCallback 이라 effect deps 에 그대로 쓴다(바뀌지 않으니 effect 가 다시 돌지 않는다).
  const { close } = queue

  // 신원 바뀜(로그아웃 시작·새 토큰 설치 직전) — AuthProvider 가 토큰을 건드리기 전에 동기로 불러, 다음 파일이
  // 빈 토큰이나 다른 사용자의 토큰으로 나가기 전에 끊고 비운다.
  useEffect(() => onIdentityChange(() => close()), [close])

  // 받침 — 신원 바뀜 알림을 거치지 않은 사용자 변화(세션 만료 뒤 다른 경로 등)도 이전 값이 있었고 지금과 다르면 끊고 비운다.
  // 처음 로그인(null → 값)은 건드리지 않는다.
  const userId = useAuth().user?.id ?? null
  const prevUserIdRef = useRef<number | null>(userId)
  useEffect(() => {
    const prev = prevUserIdRef.current
    prevUserIdRef.current = userId
    if (prev !== null && prev !== userId) close()
  }, [userId, close])

  // 언마운트 — App 이 내려갈 때(E2E 앱 다시 띄우기·HMR) 보이지 않는 요청이 남지 않게 끊는다.
  useEffect(() => close, [close])

  // 진행·대기 중이면 새로고침·닫기 확인을 띄운다(취소·완료로 busy 가 false 가 되면 뗀다).
  useUnsavedChangesWarning(queue.busy)

  const [panelHeight, setPanelHeight] = useState(0)
  // 비킴 등록부 — 등록 순서대로. 같은 key 를 다시 걸면 맨 뒤로 옮긴다(가장 최근 값이 이긴다).
  const [lifts, setLifts] = useState<Array<{ key: string; lift: string }>>([])
  const [inlineHosts, setInlineHosts] = useState(0)

  const setLift = useCallback((key: string, lift: string | undefined) => {
    setLifts((prev) => {
      const next = prev.filter((e) => e.key !== key)
      if (lift !== undefined) next.push({ key, lift })
      // 바뀐 것이 없으면 같은 배열을 돌려 다시 그리지 않는다.
      return next.length === prev.length && next.every((e, i) => e === prev[i]) ? prev : next
    })
  }, [])
  const registerInlineHost = useCallback(() => {
    setInlineHosts((n) => n + 1)
    return () => setInlineHosts((n) => n - 1)
  }, [])

  const mobileLift = lifts.length > 0 ? lifts[lifts.length - 1].lift : undefined
  const inlineHosted = inlineHosts > 0
  const layout = useMemo<DriveUploadLayoutValue>(
    () => ({ panelHeight, mobileLift, inlineHosted }),
    [panelHeight, mobileLift, inlineHosted],
  )
  const floatingHeight = inlineHosted ? 0 : panelHeight
  const actions = useMemo<DriveUploadLayoutActions>(
    () => ({ setPanelHeight, setLift, registerInlineHost }),
    [setLift, registerInlineHost],
  )

  return (
    <DriveUploadContext.Provider value={queue}>
      <DriveUploadLayoutActionsContext.Provider value={actions}>
        <DriveUploadLayoutContext.Provider value={layout}>
          <DriveUploadFloatingHeightContext.Provider value={floatingHeight}>{children}</DriveUploadFloatingHeightContext.Provider>
        </DriveUploadLayoutContext.Provider>
      </DriveUploadLayoutActionsContext.Provider>
    </DriveUploadContext.Provider>
  )
}
