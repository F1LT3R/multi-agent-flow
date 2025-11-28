# Multi-Agent Flow Agent Container
FROM node:20-slim

# Accept UID/GID as build arguments
ARG UID=1000
ARG GID=1000

# Install system dependencies for Puppeteer/Chromium and utilities
RUN apt-get update && apt-get install -y \
    curl \
    # Chromium dependencies
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    # Clean up
    && rm -rf /var/lib/apt/lists/*

# Create agent user with matching UID/GID
RUN (getent passwd ${UID} && userdel -r $(getent passwd ${UID} | cut -d: -f1)) || true && \
    (groupadd -g ${GID} agent 2>/dev/null || groupmod -n agent $(getent group ${GID} | cut -d: -f1)) && \
    useradd -u ${UID} -g ${GID} -m -s /bin/bash agent

# Install global npm packages including Puppeteer
# PUPPETEER_CACHE_DIR ensures Chromium is stored in a shared location
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer-cache
RUN mkdir -p /opt/puppeteer-cache && \
    npm install -g @modelcontextprotocol/sdk openai @anthropic-ai/sdk @google/generative-ai puppeteer && \
    chown -R agent:agent /opt/puppeteer-cache

# Set working directory
WORKDIR /workspace

# Create mount point directories
RUN mkdir -p /workspace/agent /project && \
    chown -R agent:agent /workspace /project

# Copy agent code to container
COPY ai-providers/ /workspace/agent/ai-providers/
COPY core/ /workspace/agent/core/
COPY data/ /workspace/agent/data/
COPY vm-tools/ /workspace/agent/vm-tools/

# Create package.json and install dependencies locally
RUN cd /workspace/agent && \
    echo '{"type":"module"}' > package.json && \
    npm install @modelcontextprotocol/sdk openai @anthropic-ai/sdk @google/generative-ai marked marked-terminal chalk puppeteer && \
    chown -R agent:agent /workspace/agent

# Copy MCP client script
COPY docker/mcp-client.mjs /usr/local/bin/mcp-client.mjs
RUN chmod 755 /usr/local/bin/mcp-client.mjs

# Switch to agent user
USER agent

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/opt/puppeteer-cache/chrome/linux-*/chrome-linux64/chrome

# Health check
HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "/usr/local/bin/mcp-client.mjs"]
