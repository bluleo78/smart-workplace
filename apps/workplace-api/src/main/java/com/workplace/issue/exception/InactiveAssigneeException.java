package com.workplace.issue.exception;

/**
 * 비활성화(전역 비활성·워크스페이스 정지)된 구성원을 새 담당자로 지정 시도 — 400(WP-487). 멤버이므로 「프로젝트 멤버만…」 메시지는 원인과 달라 따로 알린다. 상위
 * 예외를 그대로 이어받아 기존 매핑·처리는 바뀌지 않는다.
 */
public class InactiveAssigneeException extends InvalidAssigneeForProjectException {
  public InactiveAssigneeException() {
    super("비활성화된 구성원은 담당자로 지정할 수 없습니다");
  }
}
