package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 채널 이름 변경 요청. */
public record RenameChannelRequest(@NotBlank @Size(min = 1, max = 80) String name) {}
