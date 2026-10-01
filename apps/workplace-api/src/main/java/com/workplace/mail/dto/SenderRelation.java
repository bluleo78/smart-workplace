package com.workplace.mail.dto;

import java.util.List;

/**
 * 보낸 사람과 "나"의 관계(WP-150) — LLM 참고 신호. 규칙에는 쓰지 않는다("나 자신" 은 ⑤ 가 주소 집합으로 따로 판정).
 *
 * @param name 사내 구성원·외부 연락처의 이름(그 밖은 null)
 * @param title 직함(사내 구성원 user.title, 외부 연락처 contact_entry.title)
 * @param organization 외부 연락처의 소속 회사
 * @param sameGroups 사내 구성원과 내가 함께 속한 공유 그룹 이름("같은 조직")
 * @param favorite 내 즐겨찾기 여부(사내 구성원·외부 연락처만)
 */
public record SenderRelation(
    Kind kind,
    String name,
    String title,
    String organization,
    List<String> sameGroups,
    boolean favorite) {

  /** 판정 결과 — 먼저 맞는 것: 나 자신 → 사내 구성원 → 외부 연락처 → 알 수 없음. */
  public enum Kind {
    SELF,
    MEMBER,
    CONTACT,
    UNKNOWN
  }

  public SenderRelation {
    sameGroups = sameGroups == null ? List.of() : List.copyOf(sameGroups);
  }

  public static SenderRelation self() {
    return new SenderRelation(Kind.SELF, null, null, null, List.of(), false);
  }

  public static SenderRelation unknown() {
    return new SenderRelation(Kind.UNKNOWN, null, null, null, List.of(), false);
  }

  public static SenderRelation member(
      String name, String title, List<String> sameGroups, boolean favorite) {
    return new SenderRelation(Kind.MEMBER, name, title, null, sameGroups, favorite);
  }

  public static SenderRelation contact(
      String name, String title, String organization, boolean favorite) {
    return new SenderRelation(Kind.CONTACT, name, title, organization, List.of(), favorite);
  }
}
