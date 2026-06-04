package com.workplace.user.dto;

import java.util.List;

/** 그룹 트리 노드. children 은 sort_order→name 순으로 정렬된 직속 하위 그룹. */
public record UserGroupNode(
    long id,
    String code,
    String name,
    Long parentId,
    Long ownerId,
    String visibility,
    int sortOrder,
    List<UserGroupNode> children) {}
