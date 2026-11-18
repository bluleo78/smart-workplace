package com.workplace.drive.service;

import com.workplace.drive.dto.DriveFolderPathSegment;
import com.workplace.drive.dto.DriveFolderResponse;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Map;

/**
 * 폴더 경로 만들기(WP-1353) — 드라이브 이름 검색(공간 단위·통합 검색)과 휴지통이 같은 규약을 쓰도록 한곳에 둔다. 조상 폴더명을 '/' 로 이은 문자열이며 루트
 * 직속(folderId null)은 빈 문자열이다.
 */
public final class DriveFolderPaths {

  private DriveFolderPaths() {}

  /** id→폴더 맵을 부모로 거슬러 올라 경로를 만든다. 맵에 없는 조상에서 멈추고, 순환 방어로 1000단계를 넘지 않는다. */
  public static String pathOf(Long folderId, Map<Long, DriveFolderResponse> byId) {
    Deque<String> parts = new ArrayDeque<>();
    Long cur = folderId;
    int guard = 0;
    while (cur != null && byId.containsKey(cur) && guard++ < 1000) {
      DriveFolderResponse f = byId.get(cur);
      parts.addFirst(f.name());
      cur = f.parentId();
    }
    return String.join("/", parts);
  }

  /**
   * 공간 루트 → 부모 폴더 순의 (id, 이름) 목록. {@link #pathOf} 와 같은 규칙(맵에 없는 조상에서 멈추고 1000단계 순환 방어)으로 거슬러 오른다.
   * 화면이 각 조각을 눌러 이동하게 id 를 함께 준다.
   */
  public static List<DriveFolderPathSegment> segmentsOf(
      Long folderId, Map<Long, DriveFolderResponse> byId) {
    Deque<DriveFolderPathSegment> parts = new ArrayDeque<>();
    Long cur = folderId;
    int guard = 0;
    while (cur != null && byId.containsKey(cur) && guard++ < 1000) {
      DriveFolderResponse f = byId.get(cur);
      parts.addFirst(new DriveFolderPathSegment(f.id(), f.name()));
      cur = f.parentId();
    }
    return List.copyOf(parts);
  }
}
