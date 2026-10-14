package com.workplace.home.dto;

import com.workplace.global.ai.AiMemoryLine;
import java.util.List;

/**
 * 메모리 검색 결과(WP-383 search_memory) — 주입 블록과 같은 줄 모양(id·kind·content·scope?·expiresOn?·pinned?)이라
 * ai-agent 가 같은 형식으로 보여 주고 #id 로 바로 고치기·지우기를 할 수 있다. 꺼짐이면 memoryEnabled=false + 빈 목록(도구가 꺼짐 안내를
 * 돌려준다).
 */
public record AiMemorySearchResponse(boolean memoryEnabled, List<AiMemoryLine> items) {}
