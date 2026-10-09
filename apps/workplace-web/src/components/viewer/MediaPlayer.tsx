// 뷰어 영상·오디오 플레이어(WP-281) — 브라우저 기본 컨트롤(<video>/<audio>)에 뷰어 규칙(스펙 §5.3)만 얹는다.
// 자동재생·위치 기억·정지·blob 해제·재생 불가 판정은 여기서, 판정 기준은 mediaPlayback.ts(순수 함수)에 둔다.
import { FileAudio, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useObservedBox } from '../../hooks/useObservedBox'
import { cn } from '../../lib/utils'
import { fitMediaSize } from './mediaPlayback'

/**
 * 뷰어가 넘기는 재생 세션 — 항목이 바뀌어도(본문 리마운트) 이어져야 하는 값(자동재생 대상·재생 위치)과 재생 상태 보고 통로.
 * 뷰어가 열린 동안 고정된 객체로 넘긴다(ViewerBody memo·플레이어 이펙트가 흔들리지 않게).
 */
export interface MediaSession {
  /** 이 항목을 자동재생하는가 — 직접 연 항목만(shouldAutoplay). */
  autoplay(key: string): boolean
  /** 기억한 재생 위치(초) — 없으면 undefined. */
  position(key: string): number | undefined
  /** 떠날 때(언마운트) 재생 위치를 남긴다. */
  savePosition(key: string, seconds: number): void
  /** 재생 중 여부 보고 — 모바일 바 자동 숨김(스펙 §5.3 #2)에 쓴다. */
  onPlaying(playing: boolean): void
}

/** 무대에서 지금 미디어 요소를 찾는 표식 — 뷰어 키보드(Space·←/→)가 이 요소를 조작한다. */
export const MEDIA_ELEMENT_SELECTOR = '[data-media-player]'

/**
 * 영상·오디오 한 항목. url 은 ViewerBody 가 만든 blob object URL(해제도 ViewerBody 가 언마운트 때 한다).
 * - src 는 이펙트에서 직접 붙이고 떼어낸다 — 정리 때 src 를 지우고 load() 해 디코더·버퍼를 즉시 놓아야 하는데,
 *   JSX src 로 두면 StrictMode 재실행(같은 DOM 재사용) 때 다시 붙지 않는다.
 * - 이벤트도 이펙트에서 단다 — 정리 중 src 제거가 error/pause 를 내도 이미 뗀 뒤라 미지원 화면·재생 상태가 흔들리지 않는다.
 * - 재생 불가 코덱(HEVC .mov·.avi·.mkv 등)은 error 이벤트 → onError(호출부가 미지원 화면으로 바꾼다, 스펙 §5.3).
 */
export function MediaPlayer({
  kind,
  url,
  itemKey,
  name,
  session,
  onError,
  sideInset = false,
}: {
  kind: 'VIDEO' | 'AUDIO'
  url: string
  itemKey: string
  name: string
  session?: MediaSession
  onError: () => void
  /** 영상·오디오 좌우를 ‹ › 폭만큼 비울지(모바일 + 넘길 항목 있음). */
  sideInset?: boolean
}) {
  // 미디어 요소 — 두 갈래(영상·오디오) 모두 첫 렌더에 붙으므로 ref 로 충분하다(이펙트에서 src·이벤트를 직접 다룬다).
  const mediaRef = useRef<HTMLMediaElement>(null)
  // 자동재생이 거부됨(iOS 비동기 play·자동재생 정책) — 가운데 재생 버튼으로 폴백한다(스펙 §5.3 #5).
  const [blocked, setBlocked] = useState(false)
  // 영상 맞춤 크기 — 상자(플레이어 영역)와 원본 크기로 계산(fitMediaSize). 요소를 영상 크기로 줄여야 레터박스가 요소 밖 여백이 된다.
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  // 콜백은 최신값 ref 로 읽는다 — 이펙트를 url 단위로만 다시 돌리려고(세션·onError 정체성과 무관하게).
  const latest = useRef({ session, onError, itemKey })
  useEffect(() => {
    latest.current = { session, onError, itemKey }
  })

  const box = useObservedBox(wrap, kind === 'VIDEO')

  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    let alive = true
    const key = latest.current.itemKey
    const onLoaded = () => {
      if (el instanceof HTMLVideoElement) setNatural({ w: el.videoWidth, h: el.videoHeight })
      // 넘겼다 돌아온 항목 — 기억한 위치로(길이 안일 때만).
      const at = latest.current.session?.position(key)
      if (at != null && at > 0 && (!Number.isFinite(el.duration) || at < el.duration)) el.currentTime = at
    }
    const onPlay = () => {
      setBlocked(false)
      latest.current.session?.onPlaying(true)
    }
    const onStop = () => latest.current.session?.onPlaying(false)
    const onFail = () => latest.current.onError()
    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onStop)
    el.addEventListener('ended', onStop)
    el.addEventListener('error', onFail)
    el.src = url
    if (latest.current.session?.autoplay(key)) {
      // 속성(autoplay) 대신 play() — 거부를 잡아 폴백 버튼을 띄우려고. AbortError 는 곧바로 정리(넘김·StrictMode)되며 끊긴 것이라 무시.
      el.play().catch((err: unknown) => {
        if (alive && !(err instanceof DOMException && err.name === 'AbortError')) setBlocked(true)
      })
    }
    return () => {
      alive = false
      // 위치를 먼저 남기고(돌아오면 이어 보기) 리스너를 뗀 뒤 정지·src 제거·load() 로 디코더와 버퍼를 놓는다(스펙 §5.3 #5).
      // 메타데이터 전(복원 전)에 떠나면 0 으로 덮지 않는다 — 돌아왔다 곧바로 다시 넘겨도 기억한 위치가 남게.
      if (el.readyState >= HTMLMediaElement.HAVE_METADATA) latest.current.session?.savePosition(key, el.currentTime)
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onStop)
      el.removeEventListener('ended', onStop)
      el.removeEventListener('error', onFail)
      el.pause()
      el.removeAttribute('src')
      el.load()
      latest.current.session?.onPlaying(false)
    }
  }, [url, kind])

  // 자동재생이 막혔을 때 안내 문구 — 오디오는 보이는 힌트로, 영상은 가운데 버튼과 함께 스크린리더에만(polite).
  const blockedText = '자동 재생이 막혀 있어요 — 재생을 눌러 주세요'

  if (kind === 'AUDIO') {
    // 오디오 — 큰 아이콘 + 이름 + 기본 플레이어(시안). 탭으로 바를 숨기지 않는다(tapTogglesBars).
    return (
      // sideInset — 모바일 ‹ › 가 플레이어 끝(음량·메뉴)을 덮지 않게 좌우를 화살표 폭만큼 비운다(영상과 같은 규칙).
      <div
        className={cn('relative m-auto flex w-full max-w-md flex-col items-center gap-4 text-center', sideInset ? 'px-10' : 'px-2')}
        data-testid="media-audio-view"
      >
        <FileAudio className="h-20 w-20 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium break-all">{name}</p>
        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          controls
          preload="metadata"
          aria-label={name}
          data-media-player=""
          data-testid="media-audio"
          className="w-full"
        />
        {/* 자동재생이 막히면 — 기본 플레이어의 재생 버튼이 이미 보이므로 버튼을 겹쳐 더하지 않고 짧은 안내만(polite 알림 겸용). */}
        <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite" data-testid="media-blocked-hint">
          {blocked ? blockedText : ''}
        </p>
      </div>
    )
  }
  const fit = natural && box ? fitMediaSize(natural.w, natural.h, box.w, box.h) : null
  return (
    // 플레이어 영역 — 본문 내용 영역을 가득 채우고 영상은 그 안 가운데. 영역 밖 여백 탭 = 바 토글(스펙 §5.3 #2).
    // sideInset — 모바일에서 ‹ › 가 있으면 그 폭만큼 좌우를 비워 영상(과 네이티브 컨트롤)을 화살표가 덮지 않게 한다.
    <div
      ref={setWrap}
      className={cn('relative flex min-h-0 min-w-0 flex-1 items-center justify-center', sideInset && 'px-10')}
      data-testid="media-video-view"
    >
      <video
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        controls
        // iOS 가 재생 시 강제 전체화면으로 바꾸지 않게(스펙 §5.3 #3).
        playsInline
        preload="metadata"
        aria-label={name}
        data-media-player=""
        data-testid="media-video"
        // 크기를 재기 전엔 영역 안에 두되 숨긴다(invisible) — 원본 크기로 한 번 그렸다 맞춤 크기로 커지면 Chromium 기본 컨트롤이
        // 작은 폭 배치(시간 "0:00 0:10")로 잠깐 남아 막대가 영상 폭보다 짧게 보인다(UI 리뷰 m11). 처음 보이는 크기가 최종 크기가 되게.
        // object-contain 은 경계 반올림 오차 보정용.
        className={fit ? 'block bg-black object-contain' : 'invisible block max-h-full max-w-full bg-black object-contain'}
        style={fit ? { width: fit.w, height: fit.h } : undefined}
      />
      {blocked && (
        // 자동재생 거부 폴백(영상) — 사용자 탭(제스처)으로 다시 play() 를 부르면 허용된다. 포커스는 옮기지 않는다(Space 로도 재생 가능).
        <button
          type="button"
          aria-label={`${name} 재생`}
          data-testid="media-play-fallback"
          onClick={() => void mediaRef.current?.play().catch(() => {})}
          className="absolute top-1/2 left-1/2 z-10 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-black/60 text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Play className="size-7" aria-hidden />
        </button>
      )}
      <p className="sr-only" aria-live="polite" data-testid="media-blocked-live">
        {blocked ? blockedText : ''}
      </p>
    </div>
  )
}
