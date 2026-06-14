package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreatePageRequest(Long parentId, @NotBlank @Size(max = 255) String title) {}
