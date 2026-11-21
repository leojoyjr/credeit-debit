# Production Dockerfile for Khata Ledger
FROM node:22-alpine

# Security: Set production environment
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Install dependencies with clean install
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Ensure storage directories exist
RUN mkdir -p /app/data /app/backups /app/uploads

# Expose HTTP port
EXPOSE 3000

# Start app
CMD ["node", "src/server.js"]
