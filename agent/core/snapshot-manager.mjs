import fs from 'fs/promises'
import path from 'path'

/**
 * Snapshot Manager
 * Creates versioned snapshots that mirror the project structure.
 *
 * Snapshot structure:
 *   .flow/snapshots/{timestamp}/
 *     - User code (project root files)
 *     - .flow/flow.config.mjs
 *     - .flow/prompts/
 *     - .flow/ratchet/ (stories, reports, tests)
 *
 * Excludes: .flow/checkpoints/, .flow/traces/, .flow/snapshots/
 */
export class SnapshotManager {
	constructor(snapshotDir = './.flow/snapshots') {
		this.snapshotDir = path.resolve(snapshotDir)
		// Workspace root is parent of .flow's parent
		// snapshotDir = .flow/snapshots -> parent is .flow -> parent is workspace
		this.workspaceRoot = path.dirname(path.dirname(this.snapshotDir))
		this.flowDir = path.join(this.workspaceRoot, '.flow')
	}

	/**
	 * Create a snapshot after successful flow run
	 * Mirrors project structure including user code and relevant .flow/ parts
	 */
	async createSnapshot() {
		try {
			const timestamp = this._generateTimestamp()
			const snapshotPath = path.join(this.snapshotDir, timestamp)

			console.log(`[Snapshot] Creating at: ${snapshotPath}`)
			await fs.mkdir(snapshotPath, { recursive: true })

			// Copy user's code (everything except .flow/, node_modules/, .git/)
			console.log(`[Snapshot] Copying user code from: ${this.workspaceRoot}`)
			await this._copyUserCode(this.workspaceRoot, snapshotPath)

			// Copy relevant .flow/ parts
			console.log(`[Snapshot] Copying .flow parts`)
			await this._copyFlowParts(snapshotPath)

			console.log(`[Snapshot] Complete: ${timestamp}`)
			return timestamp
		} catch (error) {
			console.error(`[Snapshot] Error during snapshot creation:`)
			console.error(`[Snapshot] Error type: ${error.constructor.name}`)
			console.error(`[Snapshot] Error message: ${error.message}`)
			if (error.stack) {
				console.error(`[Snapshot] Stack trace:`)
				console.error(error.stack)
			}
			throw error
		}
	}

	/**
	 * Restore from a snapshot
	 * Replaces workspace with snapshot contents
	 */
	async restoreSnapshot(snapshotName) {
		const snapshotPath = path.join(this.snapshotDir, snapshotName)

		// Verify snapshot exists
		try {
			await fs.access(snapshotPath)
		} catch {
			throw new Error(`Snapshot not found: ${snapshotName}`)
		}

		// Clear current workspace (except .flow/snapshots/)
		await this._clearWorkspace()

		// Copy user code from snapshot back to workspace
		await this._restoreUserCode(snapshotPath, this.workspaceRoot)

		// Restore .flow parts from snapshot
		await this._restoreFlowParts(snapshotPath)
	}

	/**
	 * List available snapshots
	 */
	async listSnapshots() {
		try {
			const entries = await fs.readdir(this.snapshotDir, { withFileTypes: true })
			return entries
				.filter(entry => entry.isDirectory())
				.map(entry => entry.name)
				.sort()
				.reverse() // Most recent first
		} catch {
			return []
		}
	}

	/**
	 * Generate timestamp for snapshot name
	 * Format: YYYY-MM-DD_HH-MM-SS
	 */
	_generateTimestamp() {
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

		return `${datePart}_${timePart}`
	}

	/**
	 * Copy user's code to snapshot
	 * Excludes: .flow/, node_modules/, .git/, .DS_Store
	 */
	async _copyUserCode(source, dest) {
		const excludes = ['.flow', 'node_modules', '.git', '.DS_Store']

		try {
			const entries = await fs.readdir(source, { withFileTypes: true })

			for (const entry of entries) {
				if (excludes.includes(entry.name)) {
					continue
				}

				const srcPath = path.join(source, entry.name)
				const destPath = path.join(dest, entry.name)

				if (entry.isDirectory()) {
					await fs.mkdir(destPath, { recursive: true })
					await this._copyUserCode(srcPath, destPath)
				} else {
					try {
						await fs.copyFile(srcPath, destPath)
					} catch (copyErr) {
						console.error(`[Snapshot] Failed to copy file: ${srcPath}`)
						console.error(`[Snapshot] Error: ${copyErr.message}`)
						throw copyErr
					}
				}
			}
		} catch (err) {
			// If source doesn't exist, skip silently
			if (err.code !== 'ENOENT') {
				throw err
			}
		}
	}

	/**
	 * Copy relevant .flow/ parts to snapshot
	 * Includes: flow.config.mjs, prompts/, ratchet/
	 * Excludes: checkpoints/, traces/, snapshots/
	 */
	async _copyFlowParts(snapshotPath) {
		const snapshotFlowDir = path.join(snapshotPath, '.flow')
		await fs.mkdir(snapshotFlowDir, { recursive: true })

		// Copy flow.config.mjs
		const configSrc = path.join(this.flowDir, 'flow.config.mjs')
		const configDest = path.join(snapshotFlowDir, 'flow.config.mjs')
		try {
			await fs.copyFile(configSrc, configDest)
		} catch (err) {
			if (err.code !== 'ENOENT') throw err
			// Config doesn't exist, skip
		}

		// Copy prompts/
		const promptsSrc = path.join(this.flowDir, 'prompts')
		const promptsDest = path.join(snapshotFlowDir, 'prompts')
		await this._copyDirectory(promptsSrc, promptsDest)

		// Copy ratchet/ (stories, reports, tests)
		const ratchetSrc = path.join(this.flowDir, 'ratchet')
		const ratchetDest = path.join(snapshotFlowDir, 'ratchet')
		await this._copyDirectory(ratchetSrc, ratchetDest)
	}

	/**
	 * Copy a directory recursively
	 */
	async _copyDirectory(source, dest) {
		try {
			await fs.mkdir(dest, { recursive: true })
			const entries = await fs.readdir(source, { withFileTypes: true })

			for (const entry of entries) {
				const srcPath = path.join(source, entry.name)
				const destPath = path.join(dest, entry.name)

				if (entry.isDirectory()) {
					await this._copyDirectory(srcPath, destPath)
				} else {
					try {
						await fs.copyFile(srcPath, destPath)
					} catch (copyErr) {
						console.error(`[Snapshot] Failed to copy file: ${srcPath}`)
						console.error(`[Snapshot] Error: ${copyErr.message}`)
						throw copyErr
					}
				}
			}
		} catch (err) {
			// If source doesn't exist, skip silently
			if (err.code !== 'ENOENT') {
				throw err
			}
		}
	}

	/**
	 * Clear workspace for restore
	 * Keeps: .flow/snapshots/, .flow/checkpoints/, .flow/traces/
	 * Clears: user code, .flow/flow.config.mjs, .flow/prompts/, .flow/ratchet/
	 */
	async _clearWorkspace() {
		// Clear user code (everything except .flow/)
		const entries = await fs.readdir(this.workspaceRoot, { withFileTypes: true })

		for (const entry of entries) {
			if (entry.name === '.flow' || entry.name === 'node_modules' || entry.name === '.git') {
				continue
			}

			const entryPath = path.join(this.workspaceRoot, entry.name)
			await fs.rm(entryPath, { recursive: true, force: true })
		}

		// Clear restorable .flow parts
		const flowPartsToRemove = ['prompts', 'ratchet']
		for (const part of flowPartsToRemove) {
			const partPath = path.join(this.flowDir, part)
			try {
				await fs.rm(partPath, { recursive: true, force: true })
			} catch {
				// Ignore if doesn't exist
			}
		}

		// Remove config file (will be restored)
		try {
			await fs.unlink(path.join(this.flowDir, 'flow.config.mjs'))
		} catch {
			// Ignore if doesn't exist
		}
	}

	/**
	 * Restore user code from snapshot
	 */
	async _restoreUserCode(snapshotPath, dest) {
		const excludes = ['.flow']

		const entries = await fs.readdir(snapshotPath, { withFileTypes: true })

		for (const entry of entries) {
			if (excludes.includes(entry.name)) {
				continue
			}

			const srcPath = path.join(snapshotPath, entry.name)
			const destPath = path.join(dest, entry.name)

			if (entry.isDirectory()) {
				await fs.mkdir(destPath, { recursive: true })
				await this._copyUserCode(srcPath, destPath)
			} else {
				await fs.copyFile(srcPath, destPath)
			}
		}
	}

	/**
	 * Restore .flow parts from snapshot
	 */
	async _restoreFlowParts(snapshotPath) {
		const snapshotFlowDir = path.join(snapshotPath, '.flow')

		// Restore flow.config.mjs
		const configSrc = path.join(snapshotFlowDir, 'flow.config.mjs')
		const configDest = path.join(this.flowDir, 'flow.config.mjs')
		try {
			await fs.copyFile(configSrc, configDest)
		} catch (err) {
			if (err.code !== 'ENOENT') throw err
		}

		// Restore prompts/
		const promptsSrc = path.join(snapshotFlowDir, 'prompts')
		const promptsDest = path.join(this.flowDir, 'prompts')
		await this._copyDirectory(promptsSrc, promptsDest)

		// Restore ratchet/
		const ratchetSrc = path.join(snapshotFlowDir, 'ratchet')
		const ratchetDest = path.join(this.flowDir, 'ratchet')
		await this._copyDirectory(ratchetSrc, ratchetDest)
	}
}
