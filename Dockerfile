FROM mcr.microsoft.com/playwright:v1.50.0-noble

# Install Xvfb for virtual display
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Ensure storage directories exist and make startup script executable
RUN mkdir -p /app/public/screenshots /app/browser_profiles /app/data && \
    chmod +x /app/start.sh

ENV NODE_ENV=production
ENV DISPLAY=:99

EXPOSE 3000

# Start via start.sh
CMD ["/app/start.sh"]
