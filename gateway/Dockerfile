FROM node:26-alpine AS web-build
WORKDIR /build/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM maven:3.9-eclipse-temurin-21 AS gateway-build
WORKDIR /build/gateway
COPY gateway/pom.xml ./
RUN mvn -B dependency:go-offline
COPY gateway/src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=gateway-build /build/gateway/target/gateway.jar /app/gateway.jar
COPY --from=web-build /build/web/dist/ /app/web/
ENV PORT=8080 \
    WEB_ROOT=file:/app/web/ \
    ENGINE_URL=https://cdn1.lvn123.site
EXPOSE 8080
CMD ["java", "-jar", "/app/gateway.jar"]
