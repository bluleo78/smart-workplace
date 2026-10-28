package com.workplace.messaging.dto;

import java.time.Instant;

/**
 * 채널 멤버로 둔 조직도 부서 한 줄(WP-1058) — 멤버 창이 「개발팀 · 12명 [조직]」으로 보인다. 부서 구성원은 늘 MEMBER 로 들어오므로 역할은 싣지 않는다.
 *
 * @param groupId 조직도 부서(user_group, SHARED) id
 * @param name 부서 이름
 * @param memberCount 이 부서로 지금 채널에 들어오는 사람 수 — 그 부서와 하위 부서의 활성 사람 구성원(중복 제외)에서 개인 제외(내보냈거나 나간 사람)를 뺀
 *     것. 정지된 구성원은 세지 않는다(정지돼도 채널의 부서 사람 행은 남아 멤버 목록·viaGroupIds 에는 보인다)
 * @param addedAt 부서를 멤버로 둔 시각
 */
public record ChannelMemberGroupResponse(
    long groupId, String name, int memberCount, Instant addedAt) {}
