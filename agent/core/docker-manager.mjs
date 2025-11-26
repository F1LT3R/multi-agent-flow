import Docker from 'dockerode'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'

const execAsync = promisify(exec)

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

		const dockerfilePath = path.join(process.cwd(), 'agent', 'docker')
		const uid = os.userInfo().uid
		const gid = os.userInfo().gid

		try {
			const { stdout, stderr } = await execAsync(
				`docker build --build-arg UID=${uid} --build-arg GID=${gid} -t ${this.imageName} ${dockerfilePath}`,
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
					`${path.join(projectRoot, 'project')}:/workspace/project:rw`,
					`${path.join(projectRoot, 'tests')}:/workspace/tests:ro`,
					`${path.join(projectRoot, 'plans')}:/workspace/plans:ro`,
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

		const stream = await exec.start()

		return new Promise((resolve, reject) => {
			let output = ''

			stream.on('data', (chunk) => {
				output += chunk.toString()
			})

			stream.on('end', () => {
				resolve(output)
			})

			stream.on('error', reject)
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

