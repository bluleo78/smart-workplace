package com.workplace.global.config;

import com.workplace.global.tenant.TenantAwareTransactionManager;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * 기본 트랜잭션 매니저를 TenantAware 로 교체해, 트랜잭션 시작 시 active-tenant 를 RLS GUC(app.tenant_id)로 주입한다.
 * TenantContext 가 비면 GUC 를 설정하지 않으므로 기존(테넌트 무관) 동작은 그대로 유지된다.
 */
@Configuration
public class TenantDataSourceConfig {

  @Bean
  @Primary
  public PlatformTransactionManager transactionManager(DataSource dataSource) {
    return new TenantAwareTransactionManager(dataSource);
  }
}
