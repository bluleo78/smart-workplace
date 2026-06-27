package com.workplace.calendar.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 캘린더 생성/수정 요청. color 는 팔레트 키. position 은 선택(미지정 시 서비스가 말미 배치). */
public record CalendarRequest(
    @NotBlank @Size(max = 100) String name,
    @NotBlank @Size(max = 32) String color,
    Integer position) {}
