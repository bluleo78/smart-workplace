// 바깥 패널·팝오버의 Esc 닫기가 안쪽 오버레이(선택 목록·메뉴·확인 창)의 Esc 까지 먹지 않게 하는 판정(WP-698).

// 열려 있는 오버레이(다이얼로그·드로워·메뉴·팝오버·툴팁) — ESC 는 이것을 닫는 데 먼저 쓰인다.
// Radix 는 닫을 때 preventDefault 를 하지 않으므로 defaultPrevented 만으로는 구분되지 않아 DOM 으로 판정한다.
// (Radix 의 닫기 상태 갱신은 이벤트 전파가 끝난 뒤 반영되므로 바깥 리스너가 도는 시점엔 오버레이가 아직 DOM 에 있다.)
export const OPEN_OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

/**
 * 이 Esc 가 바깥 패널·팝오버를 닫는 데 쓰이면 안 되는지 — 한글 조합 중이거나, 다른 핸들러가 이미 처리했거나,
 * 자기 자신(self — 그 패널·팝오버) 말고 열린 오버레이가 있으면 그 Esc 는 그 오버레이 몫이다.
 */
export function isEscapeForInnerOverlay(e: KeyboardEvent, self?: Element | null): boolean {
  if (e.defaultPrevented || e.isComposing) return true;
  return Array.from(document.querySelectorAll(OPEN_OVERLAY_SELECTOR)).some((el) => el !== self);
}

/** 글을 쓰는 곳(입력칸·편집기)인지 — 단축키가 그 글자를 가로채지 않게 하는 공용 판정(useIssueOrigin·전역 이슈 검색). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** 글자를 쳐 넣는 input 종류 — 이 칸들의 Esc 는 「입력 취소」 몫이다. 체크박스·라디오·날짜·색·파일 등은 들지 않는다. */
const TEXT_ENTRY_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/**
 * 글을 고치는 중인 칸(글자 입력 input·textarea·contentEditable)인지 — 그 칸에서 누른 Esc 는 편집 취소 몫이라 바깥 모달을 닫지 않게 할 때 쓴다
 * (개인 작업 상세 모달, WP-1374). isEditableTarget 과 달리 select·체크박스·라디오·날짜 칸은 글 편집이 아니어서(Esc 로 취소할 글이 없다) 들지 않는다.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_ENTRY_INPUT_TYPES.has(target.type);
}
