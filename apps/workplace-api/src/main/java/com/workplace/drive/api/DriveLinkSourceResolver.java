// DriveLinkSourceResolver.java — 백링크 라벨/딥링크/접근여부 해석 SPI
package com.workplace.drive.api;

import java.util.Collection;
import java.util.Map;

/** source_type 별로 이슈/메시지를 라벨·딥링크·접근여부로 해석. 각 도메인이 구현. */
public interface DriveLinkSourceResolver {
  String sourceType(); // "ISSUE" | "MESSAGE"

  /** callerId 기준으로 sourceId 들을 해석. 접근 불가/미존재 source는 accessible=false. */
  Map<Long, Resolved> resolve(long callerId, Collection<Long> sourceIds);

  record Resolved(String label, String deepLink, boolean accessible) {}
}
