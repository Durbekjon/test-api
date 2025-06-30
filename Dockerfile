# Stage 1: Build
FROM node:20-bullseye AS builder
WORKDIR /app
# Install OpenCV and build dependencies
RUN apt-get update && \
    apt-get install -y python3 make g++ pkg-config autoconf automake libtool nasm build-essential \
    libopencv-dev libopencv-contrib-dev && \
    rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma
RUN npm install
RUN npx prisma generate
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-bullseye
WORKDIR /app
# Install OpenCV runtime dependencies
RUN apt-get update && \
    apt-get install -y libopencv-dev libopencv-contrib-dev && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
# Use non-root user for security
RUN useradd -m appuser && chown -R appuser /app
USER appuser
EXPOSE 3000
CMD ["node", "dist/main.js"]
