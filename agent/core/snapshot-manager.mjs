import fs from 'fs/promises'
import path from 'path'

/**
 * Snapshot Manager
 * Creates versioned snapshots of the entire workspace after successful runs
 */
export class SnapshotManager {
	constructor(snapshotDir = './.flow/snapshots') {
		this.snapshotDir = path.resolve(snapshotDir)
		this.previousDir = path.join(this.snapshotDir, 'previous')
	}

	/**
	 * Create a snapshot after successful flow run
	 * Copies: code files, tests, stories, prompts, config
	 */
	async createSnapshot() {
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

		const timestamp = `${datePart}_${timePart}`
		const snapshotPath = path.join(this.snapshotDir, timestamp)

		// Get workspace root (parent of .flow's parent)
		// this.snapshotDir = .flow/snapshots -> parent is .flow -> parent is workspace root
		const workspaceRoot = path.dirname(path.dirname(this.snapshotDir))

		// Copy workspace to snapshot
		await this._copyWorkspace(workspaceRoot, snapshotPath)

		// Update current symlink to point to this snapshot
		const currentLink = path.join(this.snapshotDir, 'current')
		try {
			await fs.unlink(currentLink) // Remove old symlink if exists
		} catch {
			// Ignore if doesn't exist
		}
		await fs.symlink(timestamp, currentLink)

		// Update previous/ with current snapshot
		await this._updatePrevious(snapshotPath)

		return timestamp
	}

	/**
	 * Restore from a snapshot
	 */
	async restoreSnapshot(snapshotName) {
		const snapshotPath = path.join(this.snapshotDir, snapshotName)

		// Verify snapshot exists
		try {
			await fs.access(snapshotPath)
		} catch {
			throw new Error(`Snapshot not found: ${snapshotName}`)
		}

		// Get workspace root (parent of .flow's parent)
		const workspaceRoot = path.dirname(path.dirname(this.snapshotDir))

		// Clear current workspace (except .flow)
		await this._clearWorkspace(workspaceRoot)

		// Copy snapshot back to workspace
		await this._copyWorkspace(snapshotPath, workspaceRoot)
	}

	/**
	 * List available snapshots
	 */
	async listSnapshots() {
		try {
			const entries = await fs.readdir(this.snapshotDir, { withFileTypes: true })
			return entries
				.filter(entry => entry.isDirectory() && entry.name !== 'previous' && entry.name !== 'current')
				.map(entry => entry.name)
				.sort()
				.reverse() // Most recent first
		} catch {
			return []
		}
	}

	/**
	 * Copy workspace to snapshot
	 * CRITICAL: Only copy from workspace root, never from inside .flow/
	 */
	async _copyWorkspace(source, dest) {
		// SAFETY CHECK: Never copy if source is inside .flow directory
		if (source.includes('/.flow/') || source.endsWith('/.flow')) {
			return // Don't copy anything from inside .flow
		}

		await fs.mkdir(dest, { recursive: true })

		const entries = await fs.readdir(source, { withFileTypes: true })

		for (const entry of entries) {
			const srcPath = path.join(source, entry.name)
			const destPath = path.join(dest, entry.name)

			// Skip directories and files that shouldn't be snapshotted
			const excludes = ['.flow', '.agent-flow', 'node_modules', '.git', '.DS_Store']
			if (excludes.includes(entry.name)) {
				continue
			}

			if (entry.isDirectory()) {
				await this._copyWorkspace(srcPath, destPath)
			} else {
				await fs.copyFile(srcPath, destPath)
			}
		}
	}

	/**
	 * Update previous/ directory with latest snapshot
	 */
	async _updatePrevious(snapshotPath) {
		// Clear previous
		try {
			await fs.rm(this.previousDir, { recursive: true, force: true })
		} catch {
			// Ignore if doesn't exist
		}

		// Copy snapshot to previous
		await this._copyWorkspace(snapshotPath, this.previousDir)
	}

	/**
	 * Clear workspace (except .flow directory)
	 */
	async _clearWorkspace(workspaceRoot) {
		const entries = await fs.readdir(workspaceRoot, { withFileTypes: true })

		for (const entry of entries) {
			if (entry.name === '.flow') {
				continue // Don't delete .flow directory
			}

			const entryPath = path.join(workspaceRoot, entry.name)
			await fs.rm(entryPath, { recursive: true, force: true })
		}
	}
}

