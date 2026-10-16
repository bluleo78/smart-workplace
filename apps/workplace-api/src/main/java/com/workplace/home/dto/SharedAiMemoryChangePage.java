package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/** 공간 기록 한 묶음. */
public record SharedAiMemoryChangePage(
    List<SharedAiMemoryChangeItem> items,
    @JsonInclude(JsonInclude.Include.NON_NULL) String nextCursor) {}
