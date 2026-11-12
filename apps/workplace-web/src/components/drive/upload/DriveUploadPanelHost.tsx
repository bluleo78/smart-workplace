/**
 * 업로드 패널 호스트 (WP-1534) — 업로드 패널을 그리는 자리.
 *
 * 떠 있는(floating, 기본) 호스트: 앱 셸에서 한 번만 그린다. AppLayout 의 모바일/데스크톱 셸 분기 안에 두면 lg 경계로
 * 셸이 바뀔 때 다시 마운트돼 접힘/펼침 상태가 초기화되므로 분기 밖에 둔다.
 *
 * 안쪽(inline) 호스트: 모달 시트(채널 파일 드로워)처럼 바깥을 덮고 바깥 클릭을 막는 화면이 제 안에 패널을 그린다.
 * 떠 있는 패널(z-40)은 시트 덮개(z-50) 아래에 깔리고 Radix 모달이 바깥 조작을 막아 보이지도 눌리지도 않기 때문이다.
 * 안쪽 호스트가 하나라도 마운트돼 있으면 떠 있는 호스트는 아무것도 그리지 않아 패널이 두 개 뜨지 않는다.
 *
 * 배치가 없으면 아무것도 그리지 않는다. key=batch.id 로 새 배치마다 접힘 상태를 새로 시작한다.
 */
import { useEffect } from 'react'

import { useIsMobile } from '@/hooks/useIsMobile'
import { DriveUploadPanel, type DriveUploadPanelProps } from '@/pages/drive/DriveUploadPanel'

import { useDriveUpload, useDriveUploadLayout, useDriveUploadLayoutActions } from './driveUploadContext'

type Placement = NonNullable<DriveUploadPanelProps['placement']>

/**
 * 바깥(얇은) 컴포넌트 — 배치(batch)와 안쪽 호스트 여부만 읽고, 그릴 것이 없으면 일찍 null 을 돌려준다.
 * 모바일 판정·배치 동작·패널 props 는 안쪽 컴포넌트가 가져, 그릴 것이 있을 때만 마운트·구독한다.
 * 안쪽(inline) 호스트는 배치가 없어도 자신을 등록해야 하므로 등록 effect 는 아래 InlineHostRegistration 이 맡는다.
 */
export function DriveUploadPanelHost({ placement = 'floating' }: { placement?: Placement }) {
  const { batch } = useDriveUpload()
  const { inlineHosted } = useDriveUploadLayout()
  const inline = placement === 'inline'

  return (
    <>
      {inline && <InlineHostRegistration />}
      {batch && (inline || !inlineHosted) ? <DriveUploadPanelHostBody placement={placement} /> : null}
    </>
  )
}

/** 안쪽 호스트는 마운트된 동안 등록해 떠 있는 호스트를 숨긴다(시트가 닫혀 언마운트되면 떠 있는 패널이 다시 보인다). */
function InlineHostRegistration() {
  const { registerInlineHost } = useDriveUploadLayoutActions()
  useEffect(() => registerInlineHost(), [registerInlineHost])
  return null
}

/** 안쪽 컴포넌트 — 그릴 배치가 있을 때만 마운트돼 모바일 판정·배치 동작·패널 props 를 갖는다. key=batch.id 로 새 배치마다 접힘 상태를 새로 시작한다. */
function DriveUploadPanelHostBody({ placement }: { placement: Placement }) {
  const { batch, summary, cancel, retry, close } = useDriveUpload()
  const { mobileLift } = useDriveUploadLayout()
  const { setPanelHeight } = useDriveUploadLayoutActions()
  const isMobile = useIsMobile()
  const inline = placement === 'inline'

  if (!batch || !summary) return null
  return (
    <DriveUploadPanel
      key={batch.id}
      batch={batch}
      summary={summary}
      isMobile={isMobile}
      placement={placement}
      // 안쪽 패널은 흐름 안에 자리를 차지해 목록을 가리지 않으므로 높이는 알리지 않는다(mobileLift 는 안쪽 분기에서 읽히지 않는다).
      mobileLift={mobileLift}
      onHeightChange={inline ? undefined : setPanelHeight}
      onCancel={cancel}
      onRetry={retry}
      onClose={close}
    />
  )
}
