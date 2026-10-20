package com.workplace.milestone.exception;

/** 마일스톤이 존재하지 않거나 다른 프로젝트 소속임 — 404 매핑. */
public class MilestoneNotFoundException extends RuntimeException {
  public MilestoneNotFoundException(Long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("마일스톤을 찾을 수 없습니다");
  }
}
