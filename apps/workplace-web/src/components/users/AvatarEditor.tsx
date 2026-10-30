// 아바타 바꾸기 묶음(WP-1222) — 지금 아바타(크게) + 「이미지 바꾸기」·「기본으로 되돌리기」 + 안내 + 자르기 창.
// 설정 › 프로필의 내 아바타와 설정 › 에이전트의 AI 아바타가 같이 쓴다 — 무엇을 부를지(내 API·관리자 API)와 저장 뒤 갱신은 쓰는 쪽이 정한다.
import { type ChangeEvent, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { extractApiError } from '@/lib/api-error'
import { avatarInitials } from '@/lib/avatarColor'
import { AVATAR_ACCEPT, avatarFileError } from '@/lib/avatarImage'
import { presenceStyle } from '@/lib/collab/presence'
import type { AvatarCrop } from '@/types/avatar'

import { AvatarCropDialog } from './AvatarCropDialog'
import { AvatarPicture } from './AvatarPicture'

interface AvatarEditorProps {
  userId: number
  /** 이니셜·이미지 대체 글에 쓰는 이름. */
  name: string
  /** 지금 아바타 주소 — null 이면 기본(이니셜). 「기본으로 되돌리기」는 이것이 있을 때만 보인다. */
  avatarUrl: string | null
  /** 원본 파일 + 자른 영역을 올리고 화면을 갱신한다. 실패하면 던진다(안내는 여기서 보인다). */
  upload: (file: File, crop: AvatarCrop) => Promise<void>
  /** 기본으로 되돌리고 화면을 갱신한다. 실패하면 던진다. */
  reset: () => Promise<void>
  /** 테스트 식별자 접두 — 한 화면에 둘 이상 있어도 구분되게. */
  testId?: string
}

/** 고른 파일과 그 objectURL — 자르기 창을 여는 동안만 있다. */
type Pending = { file: File; url: string }

/**
 * 파일을 고르면 형식·크기(5MB)를 먼저 보고, 맞으면 자르기 창을 연다. 가로·세로(128px 이상)는 창이 이미지를 읽은 뒤 본다.
 * 같은 파일을 다시 고를 수 있게 고른 뒤 입력 값을 비운다.
 */
export function AvatarEditor({ userId, name, avatarUrl, upload, reset, testId = 'avatar-editor' }: AvatarEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const errorId = `${testId}-error`

  // 창을 닫으며 objectURL 을 놓는다 — 고를 때마다 원본(최대 5MB)이 메모리에 남지 않게.
  const closeCrop = () => {
    if (pending) URL.revokeObjectURL(pending.url)
    setPending(null)
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const problem = avatarFileError(file)
    setError(problem)
    if (problem) return
    setPending({ file, url: URL.createObjectURL(file) })
  }

  const onSave = async (crop: AvatarCrop) => {
    if (!pending) return
    try {
      await upload(pending.file, crop)
      closeCrop()
      toast.success('아바타를 바꿨습니다.')
    } catch (err) {
      toast.error(extractApiError(err, '아바타를 바꾸지 못했습니다.'))
      // 자르기 창이 실패를 알고 버튼을 다시 풀도록 던진다.
      throw err
    }
  }

  const onReset = async () => {
    setResetting(true)
    setError(null)
    try {
      await reset()
      toast.success('기본 아바타로 되돌렸습니다.')
    } catch (err) {
      toast.error(extractApiError(err, '아바타를 되돌리지 못했습니다.'))
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-4" data-testid={testId}>
      {/* 지금 아바타 — 80px. 이미지는 256px 벌을 받는다(2배 규칙). */}
      <span
        data-testid={`${testId}-preview`}
        className="relative flex size-20 shrink-0 items-center justify-center rounded-full bg-presence text-2xl font-semibold text-presence-foreground"
        style={presenceStyle(userId)}
      >
        <AvatarPicture avatarUrl={avatarUrl} name={name} px={80}>
          {avatarInitials(name)}
        </AvatarPicture>
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={resetting} data-testid={`${testId}-change`}>
            이미지 바꾸기
          </Button>
          {avatarUrl && (
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => void onReset()}
              disabled={resetting}
              data-testid={`${testId}-reset`}
            >
              기본으로 되돌리기
            </Button>
          )}
        </div>
        {/* 파일 입력은 숨기고 버튼으로 연다 — 브라우저마다 다른 「파일 선택」 모양 대신 같은 버튼. 레이블은 테스트·화면 낭독기용. */}
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="아바타 이미지 파일"
          aria-describedby={error ? errorId : undefined}
          data-testid={`${testId}-file`}
          onChange={onFileChange}
        />
        <p className="text-xs text-muted-foreground">PNG·JPEG·GIF·WebP, 5MB 이하 — 정사각으로 잘라 저장합니다</p>
        {error && (
          <p id={errorId} role="alert" className="text-sm text-destructive" data-testid={errorId}>
            {error}
          </p>
        )}
      </div>
      {pending && (
        <AvatarCropDialog
          key={pending.url}
          imageUrl={pending.url}
          onCancel={closeCrop}
          onInvalid={(message) => {
            closeCrop()
            setError(message)
          }}
          onSave={onSave}
        />
      )}
    </div>
  )
}
