package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;

import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * AI 작업 통합 테스트 공용 시드(AgentWorkTestSupport)가 풀 커넥션의 세션 GUC 에 흔들리지 않는지(WP-827).
 *
 * <p>시드가 트랜잭션 밖(autocommit)에서 담당자·프로젝트 멤버·사용자 역할을 넣으면, 그 행의 tenant_id 는 풀에서 받은 커넥션의 세션
 * GUC(app.tenant_id)를 따른다. 다른 테스트·스케줄러가 남긴 값이 있는 커넥션을 받으면 담당자가 다른 테넌트로 들어가 테넌트#1 에서 보이지 않고, MCP 쓰기의
 * 자동 터치가 「담당자 아님」으로 조용히 건너뛰어 AgentWorkAutoStartTest 가 전체 실행에서만 가끔 실패했다. 여기서는 풀의 모든 커넥션 세션 GUC 를 비운
 * 뒤 시드를 다시 돌려 그 상황을 매번 만든다.
 */
class AgentWorkTestSupportTenantTest extends AgentWorkTestSupport {

  @Autowired private DataSource dataSource;

  @Test
  void 풀_커넥션_세션_GUC_가_비어도_시드한_담당자가_테넌트1_에서_보이고_MCP_쓰기가_작업을_시작한다() throws Exception {
    setSessionTenantOnAllPooledConnections("");
    try {
      seedAgentWorkFixture();
    } finally {
      // 비운 세션 GUC 를 기본값으로 되돌린다 — 다음 테스트의 트랜잭션 밖 쓰기가 오염되지 않게 오염을 만든 테스트가 치운다.
      setSessionTenantOnAllPooledConnections("1");
    }

    assertThat(inTenant(() -> issueAssigneeRepository.findUserIdsByIssue(issueId)))
        .containsExactlyInAnyOrder(humanId, agentId);
    assertOk(patch(patToken, Map.of("title", "진행"), TOOL));
    assertThat(activeWork(issueId, humanId))
        .hasValueSatisfying(w -> assertThat(w.state()).isEqualTo("WORKING"));
  }

  /** 풀의 커넥션을 최대 개수만큼 한꺼번에 빌려 세션 GUC 를 지정 값으로 바꾼다 — 어느 커넥션을 받아도 같은 값이 되게. */
  private void setSessionTenantOnAllPooledConnections(String tenant) throws Exception {
    int poolSize = dataSource.unwrap(HikariDataSource.class).getMaximumPoolSize();
    List<Connection> held = new ArrayList<>();
    try {
      for (int i = 0; i < poolSize; i++) {
        Connection c = dataSource.getConnection();
        held.add(c);
        try (var st = c.prepareStatement("select set_config('app.tenant_id', ?, false)")) {
          st.setString(1, tenant);
          st.execute();
        }
      }
    } finally {
      for (Connection c : held) c.close();
    }
  }
}
