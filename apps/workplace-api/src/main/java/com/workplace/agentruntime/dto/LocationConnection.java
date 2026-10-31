package com.workplace.agentruntime.dto;

/**
 * 실행 위치의 runner 연결 상태(WP-1248). runner 토큰의 마지막 사용 시각으로 계산한다.
 *
 * <ul>
 *   <li>PENDING — 한 번도 연결되지 않음(설치 대기)
 *   <li>CONNECTED — 최근(2분 이내)에 연결됨
 *   <li>DISCONNECTED — 연결된 적은 있으나 그보다 오래 소식이 없음
 * </ul>
 */
public enum LocationConnection {
  PENDING,
  CONNECTED,
  DISCONNECTED
}
