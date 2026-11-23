package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 파드끼리 접속 주소 단위 테스트(WP-1978) — IPv6 주소는 URI 에 넣을 수 있게 대괄호로 감싼다. */
class AgentScreenPodTest {

  @Test
  void address_ipv4_그대로_host_port() {
    assertThat(new AgentScreenPod("10.0.0.7", 9090).address()).isEqualTo("10.0.0.7:9090");
  }

  @Test
  void address_ipv6_은_대괄호로_감싼다() {
    assertThat(new AgentScreenPod("fd00::1", 9090).address()).isEqualTo("[fd00::1]:9090");
  }

  @Test
  void address_이미_감싼_ipv6_는_다시_감싸지_않는다() {
    assertThat(new AgentScreenPod("[fd00::1]", 9090).address()).isEqualTo("[fd00::1]:9090");
  }
}
