FROM node:20-alpine AS web-build
WORKDIR /src/website
ARG VITE_BASE_PATH=/
ARG VITE_API_BASE_URL=
ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY website/package*.json ./
RUN npm ci
COPY website/ ./
RUN npm run build

FROM golang:1.22-alpine AS server-build
WORKDIR /src/server
COPY server/go.mod ./
COPY server/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/kuviewer ./cmd/kuviewer-server

FROM alpine:3.20
RUN adduser -D -H -u 10001 kuviewer
WORKDIR /app
COPY --from=server-build /out/kuviewer /app/kuviewer
COPY --from=web-build /src/website/dist /app/static
ENV KUVIEWER_LISTEN_ADDR=0.0.0.0:8080
ENV KUVIEWER_STATIC_DIR=/app/static
EXPOSE 8080
USER kuviewer
CMD ["/app/kuviewer"]
