package com.workplace.home.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * 홈 AI 채팅 확인카드 1건(#843). 웹은 id 로 승인/거부하고, status·errorMessage 로 카드 상태를 그린다.
 *
 * @param status PENDING · DONE · FAILED · REJECTED · EXPIRED
 * @param errorMessage FAILED 일 때 사용자·AI 에게 보여줄 실패 사유
 */
public record HomeProposalResponse(
    long id,
    UUID sessionId,
    String actionType,
    String summary,
    JsonNode params,
    String status,
    String errorMessage) {}
