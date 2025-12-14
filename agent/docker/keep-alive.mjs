#!/usr/bin/env node

/**
 * Keep-Alive Script for Docker Container
 * Keeps the container running while orchestrator executes commands via docker exec
 */

console.log('[Container] Started. Waiting for commands...')

// Graceful shutdown handlers
process.on('SIGTERM', () => {
	console.log('[Container] Received SIGTERM, shutting down...')
	process.exit(0)
})

process.on('SIGINT', () => {
	console.log('[Container] Received SIGINT, shutting down...')
	process.exit(0)
})

// Keep process alive
setInterval(() => {}, 30000)

