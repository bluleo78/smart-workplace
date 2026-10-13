package com.workplace.home.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

/** 세션 메시지 1건(복원용). widgets/toolCalls 는 실제 JSON 으로 직렬화. */
public record HomeMessageResponse(
    long id,
    String role,
    String content,
    JsonNode widgets,
    /** AI 도구 호출/위임 단계(ASSISTANT 전용). null 가능. */
    JsonNode toolCalls,
    /** 표시 블록 순서(텍스트·도구 그룹·위젯, ASSISTANT 전용 — WP-158). null 이면 웹 폴백 렌더. */
    JsonNode contentBlocks,
    /** 답변 종결 상태(WP-190) — COMPLETE·STOPPED(정지·타임아웃)·FAILED(오류). */
    String status,
    Instant createdAt,
    /** 이 메시지에 붙은 첨부(WP-234, USER 전용). 없으면 빈 배열 — 새로고침 후 말풍선 복원. */
    List<HomeAttachment> attachments,
    /** 답 뒤 후속 질문(WP-139, ASSISTANT 전용). 없거나 사용자가 추천을 껐으면 null. */
    List<String> followups,
    /**
     * 메모리 결과 줄 블록(WP-55, ASSISTANT 전용) — 영속 content_blocks 의 memory 블록을 같은 순서·같은 모양으로 따로 싣는다. 없으면
     * null.
     *
     * <p>contentBlocks 에 섞어 보내면 배포 중 아직 열려 있는 구 웹이 모르는 블록을 위젯으로 그리다 이력 화면이 깨진다(구 웹은 이 필드를 무시한다). 새
     * 웹은 contentBlocks 끝에 다시 붙여 쓴다 — 되돌리기 순번(memory 블록 중 순번)은 그대로다.
     */
    JsonNode memoryBlocks) {}
