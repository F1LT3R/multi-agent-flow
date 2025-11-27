import Docker from 'dockerode'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Docker Manager
 * Manages the agent container lifecycle
 */
export class DockerManager {
	constructor(config) {
		this.config = config
		this.docker = new Docker()
		this.container = null
		this.imageName = process.env.DOCKER_IMAGE_NAME || 'multi-agent-flow-agent'
		this.containerName = `agent-flow-${Date.now()}`
	}

	/**
	 * Build the Docker image
	 */
	async buildImage() {
		console.log('[Docker] Building agent image...')

		// Get the package root using this module's location
		// __dirname is: /path/to/package/agent/core
		// Build context: /path/to/package/agent (to include ai-providers, core, etc.)
		// Dockerfile: /path/to/package/agent/docker/Dockerfile
		const buildContext = path.join(__dirname, '..')
		const dockerfilePath = path.join(buildContext, 'docker', 'Dockerfile')
		const uid = os.userInfo().uid
		const gid = os.userInfo().gid

		console.log(`[Docker] Building from context: ${buildContext}`)
		console.log(`[Docker] Using Dockerfile: ${dockerfilePath}`)

		try {
			const { stdout, stderr } = await execAsync(
				`docker build --build-arg UID=${uid} --build-arg GID=${gid} -f ${dockerfilePath} -t ${this.imageName} ${buildContext}`,
				{ maxBuffer: 10 * 1024 * 1024 }
			)

			console.log('[Docker] Image built successfully')
			return true
		} catch (error) {
			console.error('[Docker] Failed to build image:', error.message)
			throw error
		}
	}

	/**
	 * Check if image exists
	 */
	async imageExists() {
		try {
			const image = await this.docker.getImage(this.imageName)
			await image.inspect()
			return true
		} catch (error) {
			return false
		}
	}

	/**
	 * Ensure image is available (build if needed)
	 */
	async ensureImage() {
		const exists = await this.imageExists()

		if (!exists) {
			console.log('[Docker] Image not found, building...')
			await this.buildImage()
		} else {
			console.log('[Docker] Image already exists')
		}
	}

	/**
	 * Start the agent container
	 */
	async startContainer() {
		await this.ensureImage()

		console.log('[Docker] Starting agent container...')

		const projectRoot = process.cwd()

		const containerConfig = {
			Image: this.imageName,
			name: this.containerName,
			Tty: false,
			AttachStdin: false,
			AttachStdout: true,
			AttachStderr: true,
			HostConfig: {
				NetworkMode: 'host', // Access host MCP servers
		Binds: [
			// Mount strategy: Mount user project to /project, keep /workspace/agent intact
			// - /project: User's project root (RW for code files)
			// - /project/stories: User stories and reports (RW)
			// - /project/tests: Test files (RW)
			// - /project/prompts: Agent instructions (RO)
			// - /workspace/agent: Built-in agent code (NOT mounted, stays from image)
			`${projectRoot}:/project:rw`,                                    // User project root
		],
			},
		Env: [
			// API Keys
			`OPENAI_API_KEY=${process.env.OPENAI_API_KEY || ''}`,
			`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY || ''}`,
			`GOOGLE_AI_API_KEY=${process.env.GOOGLE_AI_API_KEY || ''}`,
			`XAI_API_KEY=${process.env.XAI_API_KEY || ''}`,
			// MCP Server Ports
			`MCP_FILE_OPS_PORT=${process.env.MCP_FILE_OPS_PORT || 3100}`,
			`MCP_TEST_RUNNER_PORT=${process.env.MCP_TEST_RUNNER_PORT || 3101}`,
			`MCP_ANALYSIS_PORT=${process.env.MCP_ANALYSIS_PORT || 3102}`,
			`MCP_INTERNET_PORT=${process.env.MCP_INTERNET_PORT || 3103}`,
			// MCP Host (for container to reach host MCP servers)
			`MCP_HOST=${this._getHostIP()}`,
		],
		}

		try {
			this.container = await this.docker.createContainer(containerConfig)
			await this.container.start()

			console.log(`[Docker] Container started: ${this.containerName}`)
			return this.container
		} catch (error) {
			console.error('[Docker] Failed to start container:', error.message)
			throw error
		}
	}

	/**
	 * Stop the container
	 */
	async stopContainer() {
		if (!this.container) {
			return
		}

		console.log('[Docker] Stopping container...')

		try {
			await this.container.stop({ t: 10 })
			await this.container.remove()
			console.log('[Docker] Container stopped and removed')
		} catch (error) {
			console.error('[Docker] Error stopping container:', error.message)
		}

		this.container = null
	}

	/**
	 * Execute command in container
	 */
	async exec(command) {
		if (!this.container) {
			throw new Error('Container not started')
		}

		const exec = await this.container.exec({
			Cmd: ['sh', '-c', command],
			AttachStdout: true,
			AttachStderr: true,
		})

		const stream = await exec.start({ Detach: false, Tty: false })

		return new Promise((resolve, reject) => {
			const chunks = []

			stream.on('data', (chunk) => {
				chunks.push(chunk)
			})

			stream.on('end', () => {
				// Docker uses multiplexed streams with 8-byte headers
				// Format: [STREAM_TYPE, 0, 0, 0, SIZE_1, SIZE_2, SIZE_3, SIZE_4, ...DATA...]
				// We need to demultiplex to get clean output
				const buffer = Buffer.concat(chunks)
				let output = ''
				let offset = 0

				while (offset < buffer.length) {
					// Check if we have enough bytes for header
					if (offset + 8 > buffer.length) {
						break
					}

					// Read header
					const streamType = buffer[offset]
					const payloadSize = buffer.readUInt32BE(offset + 4)

					// Move past header
					offset += 8

					// Extract payload
					if (offset + payloadSize <= buffer.length) {
						const payload = buffer.slice(offset, offset + payloadSize)
						output += payload.toString('utf-8')
						offset += payloadSize
					} else {
						break
					}
				}

				resolve(output.trim())
			})

			stream.on('error', reject)
		})
	}

	/**
	 * Get host IP address for container to reach host services
	 */
	_getHostIP() {
		// Try to get the local network IP
		const { networkInterfaces } = os
		const nets = networkInterfaces()
		
		for (const name of Object.keys(nets)) {
			for (const net of nets[name]) {
				// Skip internal and non-IPv4 addresses
				if (net.family === 'IPv4' && !net.internal) {
					return `http://${net.address}`
				}
			}
		}
		
		// Fallback to host.docker.internal (works on some Docker Desktop versions)
		return 'http://host.docker.internal'
	}

	/**
	 * Wait for container to become healthy
	 */
	async waitForHealthy(timeout = 30000) {
		if (!this.container) {
			throw new Error('Container not started')
		}

		const start = Date.now()
		
		while (Date.now() - start < timeout) {
			try {
				const inspect = await this.container.inspect()
				
				// Check if container has health check configured
				if (inspect.State.Health) {
					if (inspect.State.Health.Status === 'healthy') {
						console.log('[Docker] Container is healthy')
						return true
					}
				} else {
					// No health check, just verify it's running
					if (inspect.State.Running) {
						console.log('[Docker] Container is running (no health check)')
						return true
					}
				}
			} catch (error) {
				// Container might not exist yet, continue waiting
			}

			await new Promise((resolve) => setTimeout(resolve, 1000))
		}

		throw new Error(`Container health check timeout after ${timeout}ms`)
	}

	/**
	 * Get container logs
	 */
	async getLogs() {
		if (!this.container) {
			return ''
		}

		const logs = await this.container.logs({
			stdout: true,
			stderr: true,
		})

		return logs.toString()
	}
}

