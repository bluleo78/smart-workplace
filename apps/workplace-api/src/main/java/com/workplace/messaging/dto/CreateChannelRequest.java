package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 채널 생성 요청. visibility 가 null 이면 서비스에서 PUBLIC 으로 간주. */
public record CreateChannelRequest(
    @NotBlank @Size(min = 1, max = 80) String name, String visibility) {}
