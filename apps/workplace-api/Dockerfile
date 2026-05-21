# === Stage 1: Build ===
FROM --platform=$BUILDPLATFORM eclipse-temurin:21-jdk AS build

ENV GRADLE_OPTS="-Xmx512m"
WORKDIR /app

# 의존성 캐싱을 위해 wrapper와 빌드 파일 먼저 복사
COPY gradle/ gradle/
COPY gradlew build.gradle.kts settings.gradle.kts ./
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon || true

COPY src/ src/

RUN ./gradlew bootJar -x test --no-daemon

# === Stage 2: Runtime ===
FROM eclipse-temurin:21-jre

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar

EXPOSE 8090

ENTRYPOINT ["java", "-jar", "app.jar"]
