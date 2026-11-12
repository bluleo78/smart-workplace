package com.workplace.mail.dto;

import java.util.List;

/**
 * 서명 이미지 발송용 사본 요청(WP-1517) — 보내기 직전 작성창이 본문 서명의 이미지 id 를 싣는다.
 *
 * @param imageIds 내 서명 이미지 id(1~20개, 중복은 한 번만 만든다)
 */
public record SignatureImageStageRequest(List<Long> imageIds) {}
