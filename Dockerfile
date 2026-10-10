FROM mcr.microsoft.com/playwright:v1.50.0-noble

# Install Xvfb for virtual display
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies and matching playwright browser
COPY package*.json ./
RUN npm install --omit=dev && npx playwright install chromium

# Copy application source code
COPY . .

# Ensure storage directories exist
RUN mkdir -p /app/public/screenshots /app/browser_profiles /app/data

ENV NODE_ENV=production
ENV DISPLAY=:99

EXPOSE 3000

# Start Xvfb virtual display in background and execute node server
CMD ["sh", "-c", "rm -f /tmp/.X99-lock /tmp/.X11-unix/X99; Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset & export DISPLAY=:99; sleep 1; exec node server.js"]
