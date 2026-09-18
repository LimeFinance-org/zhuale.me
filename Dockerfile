# Use official Golang image as the builder
FROM golang:1.23-alpine AS builder

# Install build dependencies (needed for CGO/SQLite)
RUN apk add --no-cache gcc musl-dev

# Set working directory
WORKDIR /app

# Copy go mod and sum files
COPY go.mod go.sum ./

# Download all dependencies
RUN go mod download

# Copy the source code
COPY . .

# Build the application
# CGO_ENABLED=1 is required for go-sqlite3/modernc.org/sqlite (often requires CGO or has CGO-free version, modernc is CGO-free but let's check)
# modernc.org/sqlite is CGO-free, so CGO_ENABLED=0 is fine usually, but let's double check.
# Actually modernc.org/sqlite is a CGO-free port of SQLite. So CGO_ENABLED=0 works.
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Use a minimal alpine image for the runtime
FROM alpine:latest

# Set working directory
WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/main .

# Copy static files (HTML templates)
COPY index.html admin.html ./

# Expose port 8080
EXPOSE 8080

# Run the executable
CMD ["./main"]
