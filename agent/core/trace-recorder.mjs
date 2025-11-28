import fs from 'fs/promises'
import path from 'path'

/**
 * Trace Recorder
 * Records complete conversation history for every agent turn
 */
export class TraceRecorder {
	constructor(tracesDir = './traces') {
		this.tracesDir = tracesDir
	}

	/**
	 * Initialize traces directory
	 */
	async initialize() {
		await fs.mkdir(this.tracesDir, { recursive: true })
	}

	/**
	 * Record a single agent turn to a trace file
	 */
	async recordTurn(agentName, flowRun, turn, data) {
		await this.initialize()

		// Format: YYYY-MM-DD_HH-MM-SS (underscore between date and time, date first)
		const now = new Date()
		const datePart = [
			now.getFullYear(),
			String(now.getMonth() + 1).padStart(2, '0'),
			String(now.getDate()).padStart(2, '0')
		].join('-')

		const timePart = [
			String(now.getHours()).padStart(2, '0'),
			String(now.getMinutes()).padStart(2, '0'),
			String(now.getSeconds()).padStart(2, '0')
		].join('-')

		const filename = `${datePart}_${timePart}_${agentName}_r${flowRun}-t${turn}.md`
		const filepath = path.join(this.tracesDir, filename)

		const markdown = this._formatTrace(agentName, flowRun, turn, data)
		await fs.writeFile(filepath, markdown, 'utf-8')

		return filepath
	}

	/**
	 * Format trace data as markdown
	 */
	_formatTrace(agentName, flowRun, turn, data) {
		const parts = []

		// Header
		parts.push(`# ${agentName} - Run ${flowRun}, Turn ${turn}`)
		parts.push('')
		parts.push(`**Timestamp**: ${new Date(data.timestamp).toLocaleString()}`)
		parts.push(`**Model**: ${data.model}`)
		parts.push(`**Flow Run**: ${flowRun}`)
		parts.push(`**Agent Turn**: ${turn}/${data.maxTurns || '?'}`)
		parts.push('')

		// User Input
		if (data.userInput) {
			parts.push('## User Input')
			parts.push('')
			parts.push('```')
			parts.push(data.userInput)
			parts.push('```')
			parts.push('')
		}

		// System Prompt
		if (data.systemPrompt) {
			parts.push('## System Prompt')
			parts.push('')
			parts.push('```markdown')
			parts.push(data.systemPrompt.substring(0, 500) + (data.systemPrompt.length > 500 ? '...' : ''))
			parts.push('```')
			parts.push('')
		}

		// Agent Response
		if (data.response) {
			parts.push('## Agent Response')
			parts.push('')
			parts.push(data.response)
			parts.push('')
		}

		// Tool Calls
		if (data.toolCalls && data.toolCalls.length > 0) {
			parts.push('## Tool Calls')
			parts.push('')

			data.toolCalls.forEach((call, index) => {
				parts.push(`### ${index + 1}. ${call.name}`)
				parts.push('')
				parts.push('**Arguments:**')
				parts.push('```json')
				parts.push(JSON.stringify(call.arguments, null, 2))
				parts.push('```')
				parts.push('')

				if (call.result) {
					parts.push('**Result:**')
					parts.push('```json')
					parts.push(JSON.stringify(call.result, null, 2))
					parts.push('```')
					parts.push('')
				}
			})
		}

		// Token Usage
		if (data.tokenUsage) {
			parts.push('## Token Usage')
			parts.push('')
			parts.push(`- Prompt: ${data.tokenUsage.prompt_tokens || 0}`)
			parts.push(`- Completion: ${data.tokenUsage.completion_tokens || 0}`)
			parts.push(`- Total: ${data.tokenUsage.total_tokens || 0}`)
			parts.push('')
		}

		// Timing
		if (data.startTime && data.endTime) {
			const duration = new Date(data.endTime) - new Date(data.startTime)
			parts.push('## Timing')
			parts.push('')
			parts.push(`- Started: ${new Date(data.startTime).toLocaleTimeString()}`)
			parts.push(`- Completed: ${new Date(data.endTime).toLocaleTimeString()}`)
			parts.push(`- Duration: ${(duration / 1000).toFixed(1)}s`)
			parts.push('')
		}

		// Error
		if (data.error) {
			parts.push('## Error')
			parts.push('')
			parts.push('```')
			parts.push(data.error)
			parts.push('```')
			parts.push('')
		}

		// Finish Reason
		if (data.finishReason) {
			parts.push(`**Finish Reason**: ${data.finishReason}`)
			parts.push('')
		}

		return parts.join('\n')
	}

	/**
	 * List all trace files
	 */
	async listTraces() {
		try {
			const files = await fs.readdir(this.tracesDir)
			return files
				.filter((f) => f.endsWith('.md'))
				.sort()
				.reverse() // Newest first
		} catch (error) {
			if (error.code === 'ENOENT') {
				return []
			}
			throw error
		}
	}

	/**
	 * Read a trace file
	 */
	async readTrace(filename) {
		const filepath = path.join(this.tracesDir, filename)
		return await fs.readFile(filepath, 'utf-8')
	}
}

