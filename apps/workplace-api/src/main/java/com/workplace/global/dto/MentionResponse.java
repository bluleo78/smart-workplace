package com.workplace.global.dto;

/** 메시지에서 멘션된 사용자. UserSummary 와 같은 shape 이지만 응답 계약 분리를 위해 별도 record. chat·messaging 공용. */
public record MentionResponse(Long id, String username, String name, String kind) {
  /**
   * 화면에 보일 이름. name 이 null 이거나 공백뿐이면 username 으로 대체한다.
   *
   * <p>user.name 은 NOT NULL 이라 빈 문자열이 올 수 있어 null 검사만으로는 대체되지 않는다(WP-1897). 노트·위키의 멘션 라벨과 리비전 편집자
   * 표기가 한 규칙을 쓰게 한다.
   */
  public String displayName() {
    return (name == null || name.isBlank()) ? username : name;
  }
}
