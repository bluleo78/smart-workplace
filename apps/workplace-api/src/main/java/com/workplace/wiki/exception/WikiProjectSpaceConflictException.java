package com.workplace.wiki.exception;

/**
 * 프로젝트 노트 공간(WP-1480) 규칙에 어긋난 요청 — HTTP 409. 두 경우에 쓴다:
 *
 * <ul>
 *   <li>노트 앱에서 프로젝트 공간의 멤버(사람·부서)를 바꾸거나 공간을 지우려 함 — 멤버는 프로젝트 멤버로 정해진다({@link #memberLocked()})
 *   <li>기존 팀 공간 연결 조건 위반 — 이미 다른 프로젝트에 이어진 공간·개인 공간 등(문구를 직접 넘긴다)
 * </ul>
 *
 * <p>문구는 화면 토스트·AI 응답에 그대로 나가므로 한국어로, 내부 id 없이 쓴다(WP-619).
 */
public class WikiProjectSpaceConflictException extends RuntimeException {
  public WikiProjectSpaceConflictException(String message) {
    super(message);
  }

  /** 프로젝트 공간의 수동 멤버 편집·삭제 거절 — 프로젝트 설정에서 멤버를 바꾸도록 안내한다. */
  public static WikiProjectSpaceConflictException memberLocked() {
    return new WikiProjectSpaceConflictException(
        "프로젝트 노트 공간의 멤버는 프로젝트 멤버로 정해집니다 — 프로젝트 설정에서 바꿔 주세요");
  }
}
