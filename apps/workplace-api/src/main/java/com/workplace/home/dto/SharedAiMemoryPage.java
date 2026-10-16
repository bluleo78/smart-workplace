package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/** 공용 메모리 한 묶음 — nextCursor 가 없으면 끝(검색은 늘 한 묶음). count·limit 은 공간 전체 개수·상한. */
public record SharedAiMemoryPage(
    List<SharedAiMemoryItem> items,
    @JsonInclude(JsonInclude.Include.NON_NULL) String nextCursor,
    int count,
    int limit) {}
