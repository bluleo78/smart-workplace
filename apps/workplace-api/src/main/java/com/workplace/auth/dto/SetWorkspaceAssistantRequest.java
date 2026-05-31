package com.workplace.auth.dto;

import jakarta.validation.constraints.NotNull;

/** 공용 비서로 지정할 AGENT user id. */
public record SetWorkspaceAssistantRequest(@NotNull Long agentUserId) {}
