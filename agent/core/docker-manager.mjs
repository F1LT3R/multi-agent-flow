import Docker from 'dockerode'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { Writable } from 'stream'
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
	 * Build the Docker image with streaming progress output
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

		return new Promise((resolve, reject) => {
			const proc = spawn('docker', [
				'build',
				'--build-arg', `UID=${uid}`,
				'--build-arg', `GID=${gid}`,
				'-f', dockerfilePath,
				'-t', this.imageName,
				buildContext
			], { stdio: ['ignore', 'pipe', 'pipe'] })

			proc.stdout.on('data', (data) => {
				const lines = data.toString().split('\n').filter(l => l.trim())
				for (const line of lines) {
					console.log(`[Docker] ${line}`)
				}
			})

			proc.stderr.on('data', (data) => {
				const lines = data.toString().split('\n').filter(l => l.trim())
				for (const line of lines) {
					console.log(`[Docker] ${line}`)
				}
			})

			proc.on('close', (code) => {
				if (code === 0) {
					console.log('[Docker] Image built successfully')
					resolve(true)
				} else {
					reject(new Error(`Docker build failed with exit code ${code}`))
				}
			})

			proc.on('error', (err) => {
				reject(new Error(`Docker build failed: ${err.message}`))
			})
		})
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
				// No NetworkMode: 'host' needed - tools run inside VM!
				Binds: [
					// Mount strategy: Mount user project to /project, keep /workspace/agent intact
					// - /project: User's project root (RW for code files)
					// - /project/stories: User stories and reports (RW)
					// - /project/tests: Test files (RW)
					// - /project/prompts: Agent instructions (RO)
					// - /workspace/agent: Built-in agent code (NOT mounted, stays from image)
					`${projectRoot}:/project:rw`,
				],
			},
		Env: [
			// API Keys only - no MCP ports needed (tools run in VM)
			`OPENAI_API_KEY=${process.env.OPENAI_API_KEY || ''}`,
			`OPENROUTER_API_KEY=${process.env.OPENROUTER_API_KEY || ''}`,
			`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY || ''}`,
			`GOOGLE_AI_API_KEY=${process.env.GOOGLE_AI_API_KEY || ''}`,
			`XAI_API_KEY=${process.env.XAI_API_KEY || ''}`,
			`DEEPSEEK_API_KEY=${process.env.DEEPSEEK_API_KEY || ''}`,
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
	 * Execute command with real-time streaming output
	 * Separates stdout (for JSON result) from stderr (for progress output)
	 * @param {string} command - Command to execute
	 * @param {object} options - Options
	 * @param {function} options.onStderr - Callback for stderr lines
	 * @returns {Promise<string>} - Final stdout content
	 */
async execStreaming(command, options = {}) {
	if (!this.container) {
		throw new Error('Container not started')
	}

	const exec = await this.container.exec({
		Cmd: ['sh', '-c', `FORCE_COLOR=1 ${command}`],
		AttachStdout: true,
		AttachStderr: true,
	})

	const stream = await exec.start({ hijack: true, stdin: false })

	return new Promise((resolve, reject) => {
		const stdoutChunks = []
		let stderrBuffer = ''

		// Create writable streams for stdout and stderr
		const stdoutStream = new Writable({
			write(chunk, encoding, callback) {
				stdoutChunks.push(chunk)
				callback()
			}
		})

		const stderrStream = new Writable({
			write(chunk, encoding, callback) {
				stderrBuffer += chunk.toString('utf-8')

				// Process complete lines
				const lines = stderrBuffer.split('\n')
				stderrBuffer = lines.pop() // Keep incomplete line in buffer

				if (options.onStderr) {
					for (const line of lines) {
						options.onStderr(line)
					}
				}
				callback()
			}
		})

		// Use dockerode's demuxStream to separate stdout/stderr
		this.docker.modem.demuxStream(stream, stdoutStream, stderrStream)

		stream.on('end', () => {
			// Process any remaining stderr
			if (stderrBuffer.trim() && options.onStderr) {
				options.onStderr(stderrBuffer)
			}

			const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
			resolve(stdout.trim())
		})

		stream.on('error', reject)
		stdoutStream.on('error', reject)
		stderrStream.on('error', reject)
	})
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

