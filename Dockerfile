FROM mcr.microsoft.com/playwright:v1.50.0-noble

# Install Xvfb so Chromium can run with extension support on headless cloud environments
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (better-sqlite3 compiles automatically on Noble)
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Ensure storage directories exist
RUN mkdir -p /app/public/screenshots /app/browser_profiles

ENV NODE_ENV=production

EXPOSE 3000

# Start with Xvfb virtual frame buffer
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x720x24", "node", "server.js"]
