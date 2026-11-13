package com.workplace.help.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 도움말 열기 기록 요청(WP-1512). 2000자 상한은 남용 차단용이고, 200자를 넘는 값은 거절하지 않고 서비스가 자른다.
 *
 * @param route 열린 화면 경로
 * @param helpId 도움말 id(없을 수 있음)
 */
public record HelpOpenMetricRequest(
    @NotBlank @Size(max = 2000) String route, @Size(max = 200) String helpId) {}
