import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

/**
 * Checkpoint Manager
 * Handles state persistence and resumption
 */
export class CheckpointManager {
	constructor(checkpointDir) {
		this.checkpointDir = checkpointDir
	}

	/**
	 * Initialize checkpoint directory
	 */
	async initialize() {
		await fs.mkdir(this.checkpointDir, { recursive: true })
	}

	/**
	 * Save a checkpoint
	 */
	async save(runId, state) {
		const checkpointPath = this._getCheckpointPath(runId)

		const checkpoint = {
			runId,
			timestamp: new Date().toISOString(),
			version: '1.0',
			state,
		}

		await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8')

		console.log(`[CheckpointManager] Checkpoint saved: ${runId}`)
		return checkpointPath
	}

	/**
	 * Load a checkpoint
	 */
	async load(runId) {
		const checkpointPath = this._getCheckpointPath(runId)

		try {
			const content = await fs.readFile(checkpointPath, 'utf-8')
			const checkpoint = JSON.parse(content)

			console.log(`[CheckpointManager] Checkpoint loaded: ${runId}`)
			return checkpoint.state
		} catch (error) {
			if (error.code === 'ENOENT') {
				throw new Error(`Checkpoint not found: ${runId}`)
			}
			throw new Error(`Failed to load checkpoint: ${error.message}`)
		}
	}

	/**
	 * List all checkpoints
	 */
	async list() {
		try {
			const files = await fs.readdir(this.checkpointDir)
			const checkpoints = []

			for (const file of files) {
				if (file.endsWith('.json')) {
					const filePath = path.join(this.checkpointDir, file)
					const stats = await fs.stat(filePath)
					const runId = file.replace('.json', '')

					checkpoints.push({
						runId,
						timestamp: stats.mtime,
						path: filePath,
					})
				}
			}

			// Sort by timestamp (newest first)
			checkpoints.sort((a, b) => b.timestamp - a.timestamp)

			return checkpoints
		} catch (error) {
			if (error.code === 'ENOENT') {
				return []
			}
			throw error
		}
	}

	/**
	 * Get the most recent checkpoint
	 */
	async getLatest() {
		const checkpoints = await this.list()
		return checkpoints.length > 0 ? checkpoints[0] : null
	}

	/**
	 * Delete a checkpoint
	 */
	async delete(runId) {
		const checkpointPath = this._getCheckpointPath(runId)

		try {
			await fs.unlink(checkpointPath)
			console.log(`[CheckpointManager] Checkpoint deleted: ${runId}`)
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error
			}
		}
	}

	/**
	 * Generate a unique run ID
	 */
	static generateRunId() {
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

		const random = crypto.randomBytes(4).toString('hex')
		return `${datePart}_${timePart}_run_${random}`
	}

	/**
	 * Get checkpoint file path
	 */
	_getCheckpointPath(runId) {
		return path.join(this.checkpointDir, `${runId}.json`)
	}
}

/**
 * Create a state snapshot for checkpointing
 */
export function createStateSnapshot(flowState) {
	return {
		sequenceName: flowState.sequenceName,
		flowRunCount: flowState.flowRunCount,
		currentAgentIndex: flowState.currentAgentIndex,
		userInput: flowState.userInput,
		agentResults: flowState.agentResults,
		startTime: flowState.startTime,
		// Message histories
		messageHistories: flowState.messageHistories || {},
	}
}

/**
 * Restore state from snapshot
 */
export function restoreStateFromSnapshot(snapshot) {
	return {
		...snapshot,
		resuming: true,
	}
}

