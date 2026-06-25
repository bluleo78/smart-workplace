package com.workplace.calendar.dto;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/** 참석자 추가 요청 DTO. */
public record InviteAttendeesRequest(@NotEmpty List<Long> userIds) {}
