package com.workplace.help;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 도움말 검색 설정(WP-1509). WorkplaceApplication 의 {@code @ConfigurationPropertiesScan} 이 등록한다.
 *
 * @param bundleBaseUrl 웹이 도움말 묶음(/help/manual-index.json, /help/manual/*.json)을 내는 기준 주소. 운영은 클러스터
 *     안 web 서비스 (http://web), 로컬·테스트는 공개 웹 주소를 따른다.
 */
@ConfigurationProperties("workplace.help")
public record HelpProperties(String bundleBaseUrl) {}
