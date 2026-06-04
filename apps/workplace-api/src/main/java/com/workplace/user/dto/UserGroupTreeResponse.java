package com.workplace.user.dto;

import java.util.List;

/** 공유 그룹 트리(조직도)와 호출자 개인 그룹 트리를 분리해 반환. */
public record UserGroupTreeResponse(List<UserGroupNode> shared, List<UserGroupNode> personal) {}
