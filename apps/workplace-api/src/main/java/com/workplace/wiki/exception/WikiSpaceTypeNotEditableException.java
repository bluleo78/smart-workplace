package com.workplace.wiki.exception;

/**
 * 개인(PERSONAL) 노트 공간의 멤버(사람·부서) 추가·역할 변경·제거와 공간 삭제 시도(삭제 안내 보강 WP-1397) — TEAM 공간만 허용(WP-495). HTTP
 * 409.
 */
public class WikiSpaceTypeNotEditableException extends RuntimeException {
  public WikiSpaceTypeNotEditableException(long spaceId, String type) {
    // 문구에 id·영문 값을 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-672, WP-619 후속)
    // 이 예외를 쓰는 모든 곳(사람·부서 멤버 추가·역할 변경·제거, 공간 삭제)에 맞게 — 드라이브(「이름·멤버를 바꾸거나 삭제」)와 같은 꼴로 「삭제」까지 말한다 —
    // 삭제를 막고도 멤버만 언급해 엉뚱했다(WP-1397, WP-1390)
    super("팀 공간만 멤버를 바꾸거나 삭제할 수 있습니다");
  }
}
