// 아바타 자르기 창(WP-1222) — 고른 이미지를 원 안에 맞춰 끌어서 위치를, 슬라이더·휠로 확대를 정한다.
// 이미지를 캔버스로 다시 그리지 않는다: 원본 파일은 그대로 두고 원이 덮은 정사각(원본 픽셀)만 계산해 서버로 보낸다 — 서버가 자르고
// 다시 인코딩한다(EXIF 제거·여러 크기). 기하 계산은 lib/avatarCrop 의 순수 함수(테스트로 지킨다)가 한다. 새 의존성 없이 만든다.
import { type KeyboardEvent, type PointerEvent, type SyntheticEvent, useCallback, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  centeredOffset,
  clampOffset,
  clampZoom,
  coverScale,
  cropFromView,
  type ImageSize,
  maxZoom,
  type Point,
  zoomAroundCenter,
} from '@/lib/avatarCrop'
import { avatarDimensionError } from '@/lib/avatarImage'
import type { AvatarCrop } from '@/types/avatar'

/** 자르기 틀 한 변(CSS px) — 390px 폭 휴대폰의 대화상자(좌우 여백 뺀 약 310px)에도 들어간다. */
const VIEW = 256
/** 원 지름 — 틀 안쪽 24px 씩 비워 원 밖이 어둡게 보이게(무엇이 잘려 나가는지 보인다). */
const DIAMETER = 208
const INSET = (VIEW - DIAMETER) / 2
/** 화살표 키 한 번에 옮기는 거리(px). */
const KEY_STEP = 10

interface ViewState {
  img: ImageSize
  zoom: number
  offset: Point
}

/** 확대를 바꾼 상태 — 원 가운데를 기준으로 위치를 다시 잡는다(보던 곳이 달아나지 않게). */
function withZoom(v: ViewState | null, next: (zoom: number) => number): ViewState | null {
  if (!v) return v
  const zoom = clampZoom(next(v.zoom), v.img)
  const base = coverScale(v.img, DIAMETER)
  return { ...v, zoom, offset: zoomAroundCenter(v.offset, base * v.zoom, base * zoom, v.img, DIAMETER) }
}

/** 위치를 옮긴 상태 — 이미지가 원을 덮도록 묶는다. */
function withOffset(v: ViewState | null, next: (offset: Point) => Point): ViewState | null {
  if (!v) return v
  return { ...v, offset: clampOffset(next(v.offset), v.img, coverScale(v.img, DIAMETER) * v.zoom, DIAMETER) }
}

interface AvatarCropDialogProps {
  /** 고른 파일의 objectURL — 여는 쪽이 만들고 닫을 때 해제한다. 파일마다 key 로 새로 띄워 상태를 비운다. */
  imageUrl: string
  /** 이미지를 읽은 뒤 크기가 맞지 않거나(128px 미만·4000px 초과) 읽지 못하면 그 안내로 부른다 — 여는 쪽이 창을 닫고 안내를 보인다. */
  onInvalid: (message: string) => void
  onCancel: () => void
  /** 저장 — 원본 픽셀 좌표의 자른 영역. 끝날 때까지 버튼을 잠근다(실패하면 창은 그대로). */
  onSave: (crop: AvatarCrop) => Promise<void>
}

/**
 * 원형 자르기 창 — 틀 안에서 끌기(포인터)·화살표 키로 위치, 슬라이더(키보드로도)·휠·+/- 키로 확대.
 * 확대는 원 가운데를 기준으로 해 보던 곳이 달아나지 않고, 이미지가 늘 원을 덮도록 위치를 묶는다.
 */
export function AvatarCropDialog({ imageUrl, onInvalid, onCancel, onSave }: AvatarCropDialogProps) {
  const [view, setView] = useState<ViewState | null>(null)
  const [saving, setSaving] = useState(false)
  // 끌기 시작점 — 포인터 위치와 그때의 offset. 끄는 동안만 있다.
  const dragRef = useRef<{ x: number; y: number; offset: Point } | null>(null)

  const zoomTo = (next: (zoom: number) => number) => setView((v) => withZoom(v, next))
  const moveTo = (next: (offset: Point) => Point) => setView((v) => withOffset(v, next))

  // 휠 확대 — React 의 onWheel 은 passive 로 붙어 페이지 스크롤을 막지 못한다. 틀에만 passive:false 로 직접 단다.
  // 콜백 ref 로 단다: 대화상자 내용은 포털이 자리를 잡은 다음 렌더에 붙어, 첫 effect 에서는 틀이 아직 없다.
  const frameRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // 휠 한 칸(약 100) 에 약 20% — 트랙패드의 잘게 나뉜 delta 도 같은 비율로 부드럽게.
      setView((v) => withZoom(v, (z) => z * Math.exp(-e.deltaY * 0.002)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /** 이미지를 다 읽으면 크기를 검사하고 가운데에 맞춰 시작한다. */
  const onImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }
    const problem = avatarDimensionError(img.width, img.height)
    if (problem) {
      onInvalid(problem)
      return
    }
    setView({ img, zoom: 1, offset: centeredOffset(img, coverScale(img, DIAMETER), DIAMETER) })
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!view) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, offset: view.offset }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current
    if (!start) return
    moveTo(() => ({ x: start.offset.x + e.clientX - start.x, y: start.offset.y + e.clientY - start.y }))
  }
  const endDrag = () => {
    dragRef.current = null
  }

  /** 틀에 초점이 있을 때 — 화살표로 옮기고 +/- 로 확대한다(포인터 없이도 자를 수 있게). */
  const onFrameKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, Point> = {
      ArrowLeft: { x: KEY_STEP, y: 0 },
      ArrowRight: { x: -KEY_STEP, y: 0 },
      ArrowUp: { x: 0, y: KEY_STEP },
      ArrowDown: { x: 0, y: -KEY_STEP },
    }
    // 화살표는 「보는 곳」을 그쪽으로 옮긴다 — 이미지는 반대로 움직인다.
    const d = step[e.key]
    if (d) {
      e.preventDefault()
      moveTo((o) => ({ x: o.x + d.x, y: o.y + d.y }))
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      zoomTo((z) => z * 1.1)
    } else if (e.key === '-') {
      e.preventDefault()
      zoomTo((z) => z / 1.1)
    }
  }

  const save = async () => {
    if (!view) return
    setSaving(true)
    try {
      await onSave(cropFromView(view.offset, coverScale(view.img, DIAMETER) * view.zoom, view.img, DIAMETER))
    } catch {
      // 실패 안내는 여는 쪽이 보인다 — 창은 그대로 두어 다시 저장하거나 취소하게.
    } finally {
      setSaving(false)
    }
  }

  const scale = view ? coverScale(view.img, DIAMETER) * view.zoom : 1
  const zoomMax = view ? maxZoom(view.img) : 1

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // 저장 중에는 닫지 않는다 — 요청이 끝나기 전에 닫히면 결과를 알릴 곳이 없다.
        if (!open && !saving) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-sm" data-testid="avatar-crop-dialog">
        <DialogHeader>
          <DialogTitle>아바타 자르기</DialogTitle>
          <DialogDescription>끌어서 위치, 슬라이더로 확대 — 원 안이 아바타가 됩니다.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <div
            ref={frameRef}
            data-testid="avatar-crop-frame"
            role="group"
            aria-label="자를 위치 — 끌거나 화살표 키로 옮기고 +·- 키로 확대합니다"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onFrameKeyDown}
            // touch-none: 휴대폰에서 끌기가 페이지 스크롤로 새지 않게. 체커 대신 muted 바탕 — 투명 이미지 가장자리가 보인다.
            className="relative shrink-0 cursor-grab touch-none overflow-hidden rounded-md bg-muted outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
          >
            <img
              src={imageUrl}
              alt="자를 이미지"
              data-testid="avatar-crop-image"
              draggable={false}
              onLoad={onImageLoad}
              onError={() => onInvalid('이미지를 읽지 못했습니다. 다른 파일을 골라 주세요.')}
              className={view ? 'pointer-events-none absolute top-0 left-0 max-w-none origin-top-left' : 'invisible absolute'}
              style={
                view
                  ? {
                      width: view.img.width * scale,
                      height: view.img.height * scale,
                      transform: `translate(${INSET + view.offset.x}px, ${INSET + view.offset.y}px)`,
                    }
                  : undefined
              }
            />
            {/* 원 마스크 — 원 밖을 어둡게(넓은 ring 이 틀 밖까지 덮고 overflow-hidden 이 자른다) + 원 테두리. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full border-2 border-background ring-[400px] ring-black/50"
              style={{ left: INSET, top: INSET, width: DIAMETER, height: DIAMETER }}
            />
          </div>
          <input
            type="range"
            aria-label="확대"
            data-testid="avatar-crop-zoom"
            min={1}
            max={zoomMax}
            step={0.01}
            value={view?.zoom ?? 1}
            // 짧은 변이 128px 인 이미지는 더 키울 수 없다(서버 최소 128px).
            disabled={!view || zoomMax <= 1}
            onChange={(e) => {
              const zoom = Number(e.target.value)
              zoomTo(() => zoom)
            }}
            className="w-full max-w-64 accent-primary"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            취소
          </Button>
          <Button onClick={() => void save()} disabled={!view || saving} data-testid="avatar-crop-save">
            {saving ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
