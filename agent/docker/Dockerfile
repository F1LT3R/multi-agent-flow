# Multi-Agent Flow Agent Container
FROM node:20-slim

# Accept UID/GID as build arguments
ARG UID=1000
ARG GID=1000

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Create agent user with matching UID/GID
# Use existing group if GID exists, otherwise create new group
RUN (groupadd -g ${GID} agent 2>/dev/null || groupmod -n agent $(getent group ${GID} | cut -d: -f1)) && \
    useradd -u ${UID} -g ${GID} -m -s /bin/bash agent

# Install MCP SDK and AI provider dependencies globally (before switching to agent user)
RUN npm install -g @modelcontextprotocol/sdk openai @anthropic-ai/sdk @google/generative-ai

# Set working directory
WORKDIR /workspace

# Create mount point directories
# /workspace/agent: Built-in agent code (stays in image)
# /project: User's project will be mounted here
RUN mkdir -p /workspace/agent /project && \
    chown -R agent:agent /workspace /project

# Copy agent code to container (AI providers, core modules, and data)
# Note: Build context is agent/, so paths are relative to that
COPY ai-providers/ /workspace/agent/ai-providers/
COPY core/ /workspace/agent/core/
COPY data/ /workspace/agent/data/

# Create package.json and install dependencies locally
RUN cd /workspace/agent && \
    echo '{"type":"module"}' > package.json && \
    npm install @modelcontextprotocol/sdk openai @anthropic-ai/sdk @google/generative-ai && \
    chown -R agent:agent /workspace/agent

# Copy MCP client script (before switching to agent user)
COPY docker/mcp-client.mjs /usr/local/bin/mcp-client.mjs
RUN chmod 755 /usr/local/bin/mcp-client.mjs

# Switch to agent user
USER agent

# Health check - just verify node is responsive
HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=3 \
  CMD node -e "process.exit(0)"

# Default command - run MCP client
CMD ["node", "/usr/local/bin/mcp-client.mjs"]

