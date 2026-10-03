// 탭해도 현재 입력칸의 포커스를 빼앗지 않는 버튼 props(WP-196).
// 왜: 버튼을 누르는 순간 기본 동작으로 포커스가 버튼으로 옮겨가면 입력칸이 blur 되어 iOS 키보드가 내려간다.
//     pointerdown/mousedown 기본 동작만 막으면 click 은 그대로 오고 포커스(=키보드)는 입력칸에 남는다.
const preventDefault = (e: { preventDefault: () => void }) => e.preventDefault();

export const keepFocusProps = { onPointerDown: preventDefault, onMouseDown: preventDefault } as const;
