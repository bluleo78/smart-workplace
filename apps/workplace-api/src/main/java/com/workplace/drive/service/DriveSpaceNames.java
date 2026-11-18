package com.workplace.drive.service;

import java.util.Objects;

/**
 * 목록 행에 보일 공간 이름 — 개인 공간은 저장된 이름이 누구에게나 「내 드라이브」라 남이 보면 헷갈린다. 「별표」({@link DriveStarService})·「공유받은
 * 항목」({@link DriveSharedWithMeService})·「최근」({@link DriveRecentService}, WP-1699)이 같은 규칙을 쓰도록 한 곳에
 * 둔다.
 */
final class DriveSpaceNames {
  private DriveSpaceNames() {}

  /**
   * 개인 공간이 아니거나 보는 사람 자신의 개인 공간이면 저장된 이름 그대로, 남의 개인 공간이면 「{주인}의 드라이브」, 주인을 찾을 수 없으면 「개인 드라이브」.
   *
   * @param viewerId 보는 사람 id. null 이면 「내 개인 공간」 예외를 두지 않는다(공유받은 항목은 늘 주인 이름으로 보인다)
   */
  static String displayName(
      String spaceType, String spaceName, Long ownerId, String ownerName, Long viewerId) {
    boolean own = viewerId != null && Objects.equals(ownerId, viewerId);
    if (!"PERSONAL".equals(spaceType) || own) {
      return spaceName;
    }
    return ownerName != null ? ownerName + "의 드라이브" : "개인 드라이브";
  }
}
