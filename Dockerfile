# Stage 1: build frontend
FROM node:24-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: build Go server
FROM golang:1.26-alpine AS builder
RUN apk add --no-cache gcc musl-dev
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o server ./cmd/server

# Stage 3: final image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata libstdc++
WORKDIR /app
COPY --from=builder /app/server .
COPY --from=frontend-builder /frontend/dist ./frontend/dist/

EXPOSE 8000
VOLUME ["/app/data"]
CMD ["./server"]
