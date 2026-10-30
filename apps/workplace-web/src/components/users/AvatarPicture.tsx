// 아바타 이미지 한 겹(WP-1222) — 모든 아바타(UserAvatar·ChatAvatar·접속자·레일 메뉴·계정 시트·타임라인 담당자·AI 관리)가 같이 쓰는
// 「이미지 아니면 이니셜」 경로. 부모 아바타 상자(relative·크기·모양·사람 색·AI 표식)는 그대로 두고, 그 안에 이니셜(children)을 그린 위로
// 이미지를 덮는다. 이미지가 없거나 아직 안 왔거나 실패하면 이니셜이 그대로 보인다.
import { type ReactNode, useState } from 'react'

import { useAvatarUrl } from '@/hooks/avatar-map-context'
import { avatarSrc } from '@/lib/avatarImage'
import { cn } from '@/lib/utils'

interface AvatarPictureProps {
  /** 주소 표(AvatarMapContext)에서 찾을 사용자. avatarUrl 을 직접 주면 쓰지 않는다. */
  userId?: number | null
  /**
   * 주소를 이미 아는 곳(아바타 편집기 AvatarEditor 의 미리보기 — 프로필은 /users/me 값, AI 관리는 표에서 찾은 값)에서 직접 준다.
   * null 이면 「아바타 없음」. 생략하면 userId 로 찾는다 — 그 밖의 곳(레일 메뉴·계정 시트 포함)은 모두 userId 로 찾는다.
   */
  avatarUrl?: string | null
  /** 이미지 대체 글(alt) — 사람 이름. */
  name: string
  /** 화면 표시 크기(CSS px) — 받을 이미지 크기(64·128·256)를 2배 규칙으로 고른다. */
  px: number
  /** 이미지 모양 덧칠 — 기본은 원(rounded-full). AI 관리 목록처럼 둥근 네모 상자면 rounded-md 등으로 바꾼다. */
  className?: string
  /** 이미지가 없을 때(또는 로드 전·실패) 보일 이니셜. */
  children?: ReactNode
}

/**
 * 부모는 `relative` 여야 한다(이미지가 inset-0 으로 부모를 꽉 채운다). 부모의 테두리·링·배지는 이미지 위·밖에 그대로 남는다 —
 * 배지는 이 컴포넌트 뒤에 두면 위에 그려진다.
 * 이미지는 다 받은 뒤에만 보인다(그 전엔 투명) — 느린 망에서 빈 원 대신 이니셜이 보이게. 실패하면 이미지를 빼 이니셜로 돌아간다.
 */
export function AvatarPicture({ userId, avatarUrl, name, px, className, children }: AvatarPictureProps) {
  // 직접 준 주소가 있으면 표를 보지 않는다(undefined 일 때만 찾는다).
  const mapped = useAvatarUrl(avatarUrl === undefined ? userId : null)
  const src = avatarSrc(avatarUrl === undefined ? mapped : avatarUrl, px)
  // 주소별로 기억한다 — 아바타가 바뀌어 주소가 달라지면 효과 없이 저절로 「로드 전」으로 돌아간다.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (!src || failedSrc === src) return <>{children}</>
  const loaded = loadedSrc === src
  return (
    <>
      {/* 이미지가 보이는 동안 이니셜은 화면 낭독기에서 뺀다 — 이름(alt)과 첫 글자를 두 번 읽지 않게. */}
      {loaded ? <span aria-hidden="true" className="contents">{children}</span> : children}
      <img
        src={src}
        alt={name}
        loading="lazy"
        decoding="async"
        draggable={false}
        data-testid="avatar-img"
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailedSrc(src)}
        // bg-background: 투명 PNG 아래로 사람 색·이니셜이 비치지 않게.
        className={cn('absolute inset-0 size-full rounded-full bg-background object-cover', !loaded && 'opacity-0', className)}
      />
    </>
  )
}
