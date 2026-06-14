package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotNull;

public record MovePageRequest(Long parentId, @NotNull Integer position) {}
