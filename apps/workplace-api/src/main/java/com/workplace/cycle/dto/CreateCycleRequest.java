package com.workplace.cycle.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/** 사이클 생성/수정 공통 요청 본문. name 필수, 나머지는 선택. status 가 null 이면 생성 시 PLANNED, 수정 시 기존 값 유지. */
public record CreateCycleRequest(
    @NotBlank @Size(max = 60) String name,
    @Size(max = 2000) String goal,
    LocalDate startDate,
    LocalDate endDate,
    String status) {}
