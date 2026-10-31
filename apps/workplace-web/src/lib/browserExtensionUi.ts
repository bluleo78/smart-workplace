/**
 * 이벤트 대상이 브라우저 확장(1Password·Bitwarden 등 비밀번호 관리자)이 주입한 UI 인지 판별한다.
 *
 * 비밀번호 관리자는 자동완성 메뉴를 `<com-1password-menu>` 처럼 document.body 에 직접 붙인
 * 커스텀 엘리먼트(대개 shadow root 포함)로 그린다. 앱 자체의 최상위 노드(#root, Radix 포털, 토스터 등)는
 * 모두 일반 HTML 태그이므로, "body 직속 조상이 커스텀 엘리먼트(태그명에 하이픈)"이면 확장 UI 로 본다.
 * shadow root 내부 클릭은 이벤트 대상이 host 로 리타깃되므로 host 기준 판별로 충분하다.
 */
export function isBrowserExtensionUi(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  let node: Element = target
  // body 직속 자식(최상위 조상)까지 거슬러 올라간다.
  while (node.parentElement && node.parentElement !== document.body) {
    node = node.parentElement
  }
  // body 밖(html 직속 등)에 붙거나 분리된 노드도 최상위 노드 태그로 판별한다.
  return node !== document.body && node.tagName.includes('-')
}

/**
 * 이벤트 대상이 앱 토스트(Sonner 토스터) 안인지 판별한다.
 * 토스터는 앱 트리 안(다이얼로그 포털 밖)에 그려지므로, 모달 다이얼로그(전체 화면 뷰어 등)가 열린 채 토스트 단추
 * (「채팅으로 보내기」·「보기」 등, WP-1235)를 누르면 Radix 는 이를 "바깥 클릭"으로 본다.
 */
export function isToastUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-sonner-toaster]') !== null
}

/**
 * Radix Dialog/Sheet 의 onInteractOutside 에 끼워 넣는 핸들러.
 * 확장 UI 와의 상호작용(예: 1Password 메뉴에서 계정 선택)과 토스트 단추 누름을 "바깥 클릭"으로 보고
 * 팝업이 닫히는 것을 막는다.
 */
export function preventDismissOnExtensionUi(
  event: CustomEvent<{ originalEvent: Event }>,
): void {
  const target = event.detail.originalEvent.target
  if (isBrowserExtensionUi(target) || isToastUi(target)) {
    event.preventDefault()
  }
}
