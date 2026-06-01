package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 공개 채널 생성 요청. name 1~80 자. */
public record CreateChannelRequest(@NotBlank @Size(min = 1, max = 80) String name) {}
