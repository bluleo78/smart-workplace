package com.workplace.project.exception;

/** 프로젝트(또는 프로젝트 내 리소스)를 찾을 수 없을 때 발생. 404 매핑. */
public class ProjectNotFoundException extends RuntimeException {
  /**
   * 없는 프로젝트와 볼 수 없는 프로젝트에 같이 쓰는 문구(WP-588) — 둘의 응답이 다르면 비공개 TEAM·PERSONAL 프로젝트 키가 있는지 알 수 있다. 사용자가
   * 넣은 키도 되돌려 싣지 않는다.
   */
  public static final String HIDDEN_MESSAGE = "프로젝트를 찾을 수 없거나 볼 수 없습니다";

  public ProjectNotFoundException(String message) {
    super(message);
  }

  /** 없거나 볼 수 없는 프로젝트 — 둘을 구별하지 않는 404. */
  public static ProjectNotFoundException hidden() {
    return new ProjectNotFoundException(HIDDEN_MESSAGE);
  }
}
