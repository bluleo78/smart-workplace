plugins {
    java
    id("org.springframework.boot") version "3.4.1"
    id("io.spring.dependency-management") version "1.1.7"
    id("nu.studer.jooq") version "9.0"
    id("com.diffplug.spotless") version "6.25.0"
    jacoco
}

// JaCoCo — 로컬 리포트 전용. 0.8.13: Java 25(class major version 69) 지원
jacoco {
    toolVersion = "0.8.13"
}

group = "com.workplace"
version = "0.0.1-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

repositories {
    mavenCentral()
}

dependencies {
    compileOnly("org.projectlombok:lombok:1.18.44")
    annotationProcessor("org.projectlombok:lombok:1.18.44")
    testCompileOnly("org.projectlombok:lombok:1.18.44")
    testAnnotationProcessor("org.projectlombok:lombok:1.18.44")

    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-jooq")
    implementation("org.springframework.boot:spring-boot-starter-security")
    // SMTP 테스트(설정 UI) — settings 모듈 SMTP 검증 엔드포인트
    implementation("org.springframework.boot:spring-boot-starter-mail")

    // JWT (jjwt)
    implementation("io.jsonwebtoken:jjwt-api:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-impl:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-jackson:0.12.6")

    // 마이그레이션
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")

    // PostgreSQL driver — 런타임/jOOQ codegen 양쪽에서 필요
    implementation("org.postgresql:postgresql")
    jooqGenerator("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
    // 메일 연결 테스트용 임베디드 IMAP/SMTP 서버
    testImplementation("com.icegreen:greenmail-junit5:2.1.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test> {
    useJUnitPlatform()
    // JDK 25 + Mockito inline mock-maker + ByteBuddy 호환을 위한 JVM 옵션
    jvmArgs(
        "--add-opens", "java.base/java.lang=ALL-UNNAMED",
        "--add-opens", "java.base/java.lang.reflect=ALL-UNNAMED",
        "--add-opens", "java.base/java.util=ALL-UNNAMED",
        "-XX:+EnableDynamicAgentLoading",
        "-Dnet.bytebuddy.experimental=true"
    )
    // 테스트 완료 후 JaCoCo 리포트 자동 생성
    finalizedBy(tasks.jacocoTestReport)
}

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
    // 제외: jOOQ 코드젠 결과물, 단순 DTO/예외(생성자 위주라 의미있는 로직 없음)
    classDirectories.setFrom(
        files(
            classDirectories.files.map {
                fileTree(it) {
                    exclude(
                        "com/workplace/jooq/**",
                        "**/dto/**",
                        "**/*Exception.class",
                    )
                }
            }
        )
    )
}

// Spotless — Google Java Format
spotless {
    java {
        googleJavaFormat("1.34.1")
        target("src/main/java/**/*.java", "src/test/java/**/*.java")
        // jOOQ 코드젠 결과물 제외
        targetExclude("src/main/generated/**")
    }
}

// jOOQ codegen — workplace 로컬 개발 DB에서 public 스키마 읽어 타입 안전 SQL 생성
// 결과물: src/main/generated/com/workplace/jooq/
// compileJava 가 자동으로 codegen 을 트리거하지 않도록 분리 (DB 없이 빌드 가능).
// 스키마 변경 후 명시적으로 `./gradlew generateJooq` 실행.
jooq {
    configurations {
        create("main") {
            generateSchemaSourceOnCompilation.set(false)
            jooqConfiguration.apply {
                jdbc.apply {
                    driver = "org.postgresql.Driver"
                    url = "jdbc:postgresql://localhost:5434/workplace"
                    user = "app"
                    password = "app"
                }
                generator.apply {
                    name = "org.jooq.codegen.DefaultGenerator"
                    database.apply {
                        name = "org.jooq.meta.postgres.PostgresDatabase"
                        inputSchema = "public"
                        // Flyway 내부 테이블은 도메인 코드에서 직접 다룰 일 없음
                        excludes = "flyway_schema_history"
                    }
                    target.apply {
                        packageName = "com.workplace.jooq"
                        directory = "src/main/generated"
                    }
                }
            }
        }
    }
}

