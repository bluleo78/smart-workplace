package com.workplace.global.share;

/**
 * 드라이브·노트 공간 역할 서열(OWNER &gt; EDITOR &gt; VIEWER)을 자바에서 다루는 도우미(WP-1166). 두 공간의 역할 이름·서열이 같아 한 곳에
 * 둔다 — 멤버 목록이 직접 역할과 부서 역할을 합칠 때 쓴다. SQL 쪽 서열은 각 Membership 의 {@code rank} 가 같은 순서로 맡는다.
 */
public final class SpaceRoles {
  private SpaceRoles() {}

  /** 두 역할 중 높은 것 — 한쪽이 null 이면 다른 쪽. */
  public static String higher(String a, String b) {
    if (a == null) return b;
    if (b == null) return a;
    return rankOf(b) > rankOf(a) ? b : a;
  }

  /**
   * 멤버 창에 안내할 부서 역할 — 부서로 받는 역할이 직접 역할보다 <b>높을 때만</b> 그 역할, 아니면 null. 화면이 역할 서열을 따로 갖지 않고 이 값이 있을
   * 때만 「조직으로 편집자」를 보이게 서버가 판정한다.
   */
  public static String departmentRoleAbove(String directRole, String departmentRole) {
    return departmentRole != null && rankOf(departmentRole) > rankOf(directRole)
        ? departmentRole
        : null;
  }

  // 알 수 없는 역할·null 은 가장 낮게 본다.
  private static int rankOf(String role) {
    return switch (role == null ? "" : role) {
      case "OWNER" -> 3;
      case "EDITOR" -> 2;
      case "VIEWER" -> 1;
      default -> 0;
    };
  }
}
