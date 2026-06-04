package com.workplace.user.dto;

import java.util.List;

/** 그룹 상세 + 직속 멤버 목록(이름 오름차순). */
public record UserGroupDetail(
    long id,
    String code,
    String name,
    Long parentId,
    Long ownerId,
    String visibility,
    int sortOrder,
    List<UserGroupMemberSummary> members) {}
