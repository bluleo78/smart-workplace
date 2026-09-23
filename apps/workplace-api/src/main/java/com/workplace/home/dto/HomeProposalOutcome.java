package com.workplace.home.dto;

/**
 * 확인카드 승인/거부 처리 결과(#843). 실행 실패도 "처리 완료된 요청"으로 보고 200 으로 돌려준다 — 실패 사실과 사유가 제안 행·대화 이력에 이미 기록됐고, 웹은
 * 이 응답으로 카드를 FAILED 로 바꾸고 결과 메시지를 대화에 붙인다.
 *
 * @param proposal 전이 후 제안 상태
 * @param message 대화 이력에 추가된 결과 메시지(role=ACTION_*)
 */
public record HomeProposalOutcome(HomeProposalResponse proposal, HomeMessageResponse message) {}
