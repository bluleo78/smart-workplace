package com.workplace;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/** Gen:iA Works API 진입점. 스케줄링 활성화는 {@link com.workplace.global.config.SchedulingConfig} 참조. */
@SpringBootApplication
@ConfigurationPropertiesScan
public class WorkplaceApplication {

  public static void main(String[] args) {
    SpringApplication.run(WorkplaceApplication.class, args);
  }
}
