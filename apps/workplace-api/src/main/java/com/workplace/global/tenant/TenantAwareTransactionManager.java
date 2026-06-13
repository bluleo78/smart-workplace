package com.workplace.global.tenant;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 트랜잭션 시작 직후 active-tenant 를 트랜잭션-로컬 GUC(app.tenant_id)로 주입한다. set_config(...,true) 는 트랜잭션 종료 시 자동
 * 해제되어 커넥션 풀 누수가 없다. TenantContext 가 비면(tenant-less) 설정하지 않으며, RLS 정책은 미설정 GUC 를 NULL 로 보아
 * fail-closed 차단한다.
 *
 * <p>주: 후속 Stage(RLS 테이블 도입)에서 @Primary 트랜잭션 매니저로 배선된다.
 */
public class TenantAwareTransactionManager extends DataSourceTransactionManager {

  public TenantAwareTransactionManager(DataSource dataSource) {
    super(dataSource);
  }

  @Override
  protected void doBegin(Object transaction, TransactionDefinition definition) {
    super.doBegin(transaction, definition);
    Long tenantId = TenantContext.get();
    if (tenantId == null) {
      return;
    }
    Connection con = obtainBoundConnection();
    try (PreparedStatement ps =
        con.prepareStatement("SELECT set_config('app.tenant_id', ?, true)")) {
      ps.setString(1, tenantId.toString());
      ps.execute();
    } catch (SQLException e) {
      throw new CannotCreateTransactionException("app.tenant_id GUC 설정 실패", e);
    }
  }

  private Connection obtainBoundConnection() {
    ConnectionHolder holder =
        (ConnectionHolder) TransactionSynchronizationManager.getResource(obtainDataSource());
    return holder.getConnection();
  }
}
