FROM mcr.microsoft.com/playwright:v1.50.0-noble

# Install Xvfb (X Virtual FrameBuffer) so Chromium loads browser extensions seamlessly in cloud
RUN apt-get update && apt-get install -y \
    xvfb \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package definition and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Ensure storage and profile directories exist
RUN mkdir -p /app/public/screenshots /app/browser_profiles

# Expose Railway assigned PORT (defaults to 3000)
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Run with Xvfb virtual display
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x720x24", "node", "server.js"]
