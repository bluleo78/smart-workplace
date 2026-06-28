package com.workplace.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 본인이 개인 비서의 표시 이름을 변경할 때 입력. name 은 DB user.name VARCHAR(50) 과 맞춰 max=50. */
public record UpdateAssistantNameRequest(@NotBlank @Size(max = 50) String name) {}
