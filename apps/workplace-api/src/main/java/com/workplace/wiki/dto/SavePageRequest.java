package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record SavePageRequest(
    @Size(max = 255) String title, String body, @NotNull Integer version, boolean snapshot) {}
