// 노트 페이지 제목 → 다운로드용 .md 파일명. DOM 비의존 순수 함수.
// 제목은 사용자 자유 입력이라 경로 구분자·예약 문자·제어문자가 섞일 수 있고, 그대로 쓰면
// OS 별로 저장이 실패하거나 의도치 않은 경로에 쓰인다. 여기서 한 번에 정리한다.

/**
 * 파일명 본문(확장자 제외) 최대 길이 — UTF-16 코드 유닛 기준.
 * 한글 100자는 UTF-8 로 약 300바이트라 파일 시스템의 255바이트 한계를 넘을 수 있다.
 * 여기 목적은 무한정 긴 제목을 막는 것이지 바이트 한계를 정확히 맞추는 것이 아니다.
 */
const MAX_BASE_LENGTH = 100

/**
 * 페이지 제목을 안전한 `<이름>.md` 파일명으로 변환한다.
 * 항상 `.md` 로 끝나며, 새니타이즈 결과가 비면 `untitled.md` 를 반환한다.
 */
export function wikiMarkdownFilename(title: string): string {
  const base = title
    // macOS 등에서 온 NFD 문자열을 NFC 로 통일 — 다른 OS 에서 자모가 분리돼 보이는 것을 막는다
    // (Drive 파일명 정책과 동일).
    .normalize('NFC')
    // 경로 구분자와 Windows 예약 문자를 _ 로 치환.
    .replace(/[/\\:*?"<>|]/g, '_')
    // 제어문자는 흔적 없이 제거.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // 앞뒤 공백·점 제거 — 점으로 시작하면 숨김 파일, 점으로 끝나면 Windows 가 거부한다.
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    // slice 가 자른 자리에 다시 공백·점이 남을 수 있다(예: 99자 뒤에 '.b' 가 오면 자른
    // 끝이 '.' 가 됨) — 위의 "앞뒤 공백·점 제거"가 최종 결과에 대해 성립하도록 한 번 더 적용.
    .replace(/^[\s.]+|[\s.]+$/g, '')

  return `${base || 'untitled'}.md`
}
