import fs from 'fs/promises'
import path from 'path'

/**
 * Structured Logger
 * Logs events to .jsonl files for debugging and auditing
 */
export class Logger {
	constructor(logDir = './.agent-flow/logs') {
		this.logDir = logDir
		this.currentLogFile = null
		this.sessionId = null
	}

	/**
	 * Initialize logger with new session
	 */
	async initialize(sessionId = null) {
		this.sessionId = sessionId || this._generateSessionId()
		
		// Ensure log directory exists
		await fs.mkdir(this.logDir, { recursive: true })

		// Create log file for this session
		this.currentLogFile = path.join(
			this.logDir,
			`session-${this.sessionId}.jsonl`
		)

		await this.log('session_start', { sessionId: this.sessionId })
	}

	/**
	 * Log an event
	 */
	async log(event, data = {}, level = 'info') {
		const logEntry = {
			timestamp: new Date().toISOString(),
			sessionId: this.sessionId,
			level,
			event,
			data,
		}

		// Write to file
		if (this.currentLogFile) {
			try {
				await fs.appendFile(
					this.currentLogFile,
					JSON.stringify(logEntry) + '\n',
					'utf-8'
				)
			} catch (error) {
				console.error('Failed to write log:', error.message)
			}
		}

		// Also console log for important events
		if (level === 'error' || level === 'warn') {
			console.error(`[${level.toUpperCase()}]`, event, data)
		}
	}

	/**
	 * Log info event
	 */
	async info(event, data = {}) {
		await this.log(event, data, 'info')
	}

	/**
	 * Log warning event
	 */
	async warn(event, data = {}) {
		await this.log(event, data, 'warn')
	}

	/**
	 * Log error event
	 */
	async error(event, data = {}) {
		await this.log(event, data, 'error')
	}

	/**
	 * Log agent turn
	 */
	async logTurn(agentName, turnNumber, data = {}) {
		await this.info('agent_turn', {
			agent: agentName,
			turn: turnNumber,
			...data,
		})
	}

	/**
	 * Log tool call
	 */
	async logToolCall(toolName, args, result) {
		await this.info('tool_call', {
			tool: toolName,
			arguments: args,
			success: result.success !== false,
		})
	}

	/**
	 * Generate session ID
	 */
	_generateSessionId() {
		return new Date().toISOString().replace(/[:.]/g, '-')
	}

	/**
	 * Get log file path
	 */
	getLogFile() {
		return this.currentLogFile
	}

	/**
	 * Parse log file
	 */
	static async parseLogFile(logFile) {
		const content = await fs.readFile(logFile, 'utf-8')
		const lines = content.trim().split('\n')
		return lines.map((line) => JSON.parse(line))
	}
}

