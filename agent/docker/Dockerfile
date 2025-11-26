# Multi-Agent Flow Agent Container
FROM node:20-slim

# Accept UID/GID as build arguments
ARG UID=1000
ARG GID=1000

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Create agent user with matching UID/GID
RUN groupadd -g ${GID} agent && \
    useradd -u ${UID} -g ${GID} -m -s /bin/bash agent

# Set working directory
WORKDIR /workspace

# Create mount point directories
RUN mkdir -p /workspace/project /workspace/tests /workspace/plans && \
    chown -R agent:agent /workspace

# Switch to agent user
USER agent

# Install MCP SDK globally for the agent
RUN npm install -g @modelcontextprotocol/sdk

# Copy MCP client script
COPY --chown=agent:agent mcp-client.mjs /usr/local/bin/mcp-client.mjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3100/health || exit 1

# Default command - run MCP client
CMD ["node", "/usr/local/bin/mcp-client.mjs"]

