# Multi-Agent Flow Agent Container
FROM node:20-slim

# Accept UID/GID as build arguments
ARG UID=1000
ARG GID=1000

# Install system dependencies for Puppeteer/Chromium and utilities
# Using chromium from apt instead of Puppeteer's bundled version for ARM compatibility
RUN apt-get update && apt-get install -y \
    curl \
    chromium \
    # Clean up
    && rm -rf /var/lib/apt/lists/*

# Create agent user with matching UID/GID
RUN (getent passwd ${UID} && userdel -r $(getent passwd ${UID} | cut -d: -f1)) || true && \
    (groupadd -g ${GID} agent 2>/dev/null || groupmod -n agent $(getent group ${GID} | cut -d: -f1)) && \
    useradd -u ${UID} -g ${GID} -m -s /bin/bash agent

# Tell Puppeteer to skip downloading Chromium and use system chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install global npm packages
RUN npm install -g @modelcontextprotocol/sdk openai @anthropic-ai/sdk @google/generative-ai puppeteer

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

# Copy keep-alive script
COPY docker/keep-alive.mjs /usr/local/bin/keep-alive.mjs
RUN chmod 755 /usr/local/bin/keep-alive.mjs

# Switch to agent user
USER agent

# Health check
HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "/usr/local/bin/keep-alive.mjs"]
