// 복사 + 결과 토스트 — 복사 버튼마다 되풀이되던 「복사 → 성공/실패 안내」를 한 곳에 둔다.
// 복사 자체는 copyText(Clipboard API → execCommand 대체)를 쓰고, 여기서는 결과에 맞는 토스트만 고른다.
import { toast } from 'sonner'

import { copyText } from './copyText'

/** 성공·실패 때 띄울 토스트 문구 — 실패 문구는 직접 선택해 복사하라는 안내를 담는다. */
export interface CopyToastMessages {
  success: string
  failure: string
  /** 성공 토스트에 붙일 다음 동작 단추(예: 링크 복사 뒤 「채팅으로 보내기」, WP-1235). 없으면 문구만. */
  successAction?: { label: string; onClick: () => void }
}

/** text 를 복사하고 결과를 토스트로 알린다. 성공 여부를 돌려준다(예외는 던지지 않는다). */
export async function copyToClipboard(text: string, messages: CopyToastMessages): Promise<boolean> {
  const ok = await copyText(text)
  if (ok) {
    // 다음 동작이 없으면 문구만 넘긴다 — 기존 호출부·테스트가 보던 모양 그대로.
    if (messages.successAction) toast.success(messages.success, { action: messages.successAction })
    else toast.success(messages.success)
  }
  else toast.error(messages.failure)
  return ok
}
