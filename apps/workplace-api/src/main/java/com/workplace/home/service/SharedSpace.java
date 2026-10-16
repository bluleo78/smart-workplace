package com.workplace.home.service;

/**
 * 공용 메모리 공간(WP-386 스펙 3절) — 조직(ORG, id 없음)·프로젝트(TEAM·OPEN)·노트 스페이스(TEAM). key 는 프로젝트 키(그 밖은 null),
 * name 은 화면·블록 라벨의 재료.
 */
public record SharedSpace(Type type, Long id, String key, String name) {

  /** 공간 종류 — DB space_type 과 같은 이름. */
  public enum Type {
    ORG,
    PROJECT,
    WIKI_SPACE
  }

  /** DB 키(space_type, space_id) — 조직은 id null. */
  public record SpaceKey(String type, Long id) {

    /** 형식 검사 포함 — 조직은 id 를 버리고, 다른 종류는 id 가 있어야 한다. 모르는 종류·빠진 id 는 null. */
    public static SpaceKey of(String type, Long id) {
      if ("ORG".equals(type)) return new SpaceKey("ORG", null);
      if (("PROJECT".equals(type) || "WIKI_SPACE".equals(type)) && id != null && id > 0) {
        return new SpaceKey(type, id);
      }
      return null;
    }

    /** `ORG`·`PROJECT:12` 형식(웹 딥링크·화면 파라미터와 같다). */
    public String param() {
      return id == null ? type : type + ":" + id;
    }
  }

  /** 조직 공간. */
  public static SharedSpace org() {
    return new SharedSpace(Type.ORG, null, null, "조직");
  }

  /** 블록·결과 줄 라벨 — 조직「조직」, 프로젝트「이름(키)」, 스페이스「이름」. */
  public String label() {
    return switch (type) {
      case ORG -> "조직";
      case PROJECT -> name + "(" + key + ")";
      case WIKI_SPACE -> name;
    };
  }

  /** DB 키. */
  public SpaceKey spaceKey() {
    return new SpaceKey(type.name(), id);
  }

  /** `ORG`·`PROJECT:12`. */
  public String param() {
    return spaceKey().param();
  }
}
