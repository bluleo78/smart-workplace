package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 스테이징 파일 클레임 요청(WP-424) — 먼저 올려 둔 파일의 id 목록. 한 번에 최대 10개(페이지 누적 한도는 서비스가 다시 본다).
 *
 * <p>WP-1545 부터 이미지뿐 아니라 모든 파일 형식을 클레임한다. 이름(Images)은 호환을 위해 그대로 둔다.
 */
public record ClaimWikiImagesRequest(@NotEmpty @Size(max = 10) List<Long> fileIds) {}
