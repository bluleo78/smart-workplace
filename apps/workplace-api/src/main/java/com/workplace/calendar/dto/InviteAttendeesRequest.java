package com.workplace.calendar.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

/** 참석자 추가 요청 DTO. */
public record InviteAttendeesRequest(
    // 같은 id 를 수만 번 넣으면 요청 하나가 수 초 걸렸다(WP-794).
    @NotEmpty @Size(max = 500, message = "참석자는 한 번에 500명까지 초대할 수 있습니다") List<Long> userIds) {}
