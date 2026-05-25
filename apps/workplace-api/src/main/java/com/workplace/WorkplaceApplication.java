package com.workplace;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/** Smart Workplace API 진입점. */
@SpringBootApplication
@ConfigurationPropertiesScan
public class WorkplaceApplication {

  public static void main(String[] args) {
    SpringApplication.run(WorkplaceApplication.class, args);
  }
}
