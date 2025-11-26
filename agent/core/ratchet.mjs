import fs from 'fs/promises'
import path from 'path'

/**
 * Ratcheting System
 * Promotes successful code and tests from ./project to permanent storage
 */
export class Ratchet {
	constructor(config) {
		this.config = config
		this.projectTestsDir = path.join(config.paths.project, 'tests')
		this.projectArtifactsDir = path.join(config.paths.project, 'tests', 'artifacts')
		this.permanentTestsDir = config.paths.tests
		this.permanentArtifactsDir = config.paths.artifacts
	}

	/**
	 * Ratchet tests and artifacts after successful flow
	 */
	async ratchet() {
		console.log('[Ratchet] Starting ratcheting process...')

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
		const operations = []

		// Check if project tests directory exists
		try {
			await fs.access(this.projectTestsDir)
		} catch (error) {
			console.log('[Ratchet] No tests found in project directory, skipping.')
			return { success: true, operations: [] }
		}

		// Move tests
		const testsMoved = await this._moveTests(timestamp)
		operations.push(...testsMoved)

		// Move artifacts
		const artifactsMoved = await this._moveArtifacts(timestamp)
		operations.push(...artifactsMoved)

		console.log(`[Ratchet] Ratcheting complete. ${operations.length} operations performed.`)

		return {
			success: true,
			operations,
			timestamp,
		}
	}

	/**
	 * Move tests from ./project/tests to ./tests
	 */
	async _moveTests(timestamp) {
		const operations = []

		try {
			// Ensure permanent tests directory exists
			await fs.mkdir(this.permanentTestsDir, { recursive: true })

			// Get all test files
			const files = await this._getFiles(this.projectTestsDir)

			for (const file of files) {
				// Skip artifacts directory
				if (file.includes('/artifacts/')) {
					continue
				}

				const relativePath = path.relative(this.projectTestsDir, file)
				const destPath = path.join(this.permanentTestsDir, relativePath)

				// Create destination directory
				await fs.mkdir(path.dirname(destPath), { recursive: true })

				// Copy file (preserve original)
				await fs.copyFile(file, destPath)

				operations.push({
					type: 'test',
					source: file,
					destination: destPath,
					timestamp,
				})

				console.log(`[Ratchet] Test promoted: ${relativePath}`)
			}
		} catch (error) {
			console.error('[Ratchet] Error moving tests:', error.message)
		}

		return operations
	}

	/**
	 * Move artifacts from ./project/tests/artifacts to ./tests/artifacts
	 */
	async _moveArtifacts(timestamp) {
		const operations = []

		try {
			// Check if artifacts directory exists
			await fs.access(this.projectArtifactsDir)

			// Ensure permanent artifacts directory exists
			await fs.mkdir(this.permanentArtifactsDir, { recursive: true })

			// Get all artifact files
			const files = await this._getFiles(this.projectArtifactsDir)

			for (const file of files) {
				const relativePath = path.relative(this.projectArtifactsDir, file)
				const destPath = path.join(this.permanentArtifactsDir, relativePath)

				// Create destination directory
				await fs.mkdir(path.dirname(destPath), { recursive: true })

				// Copy file
				await fs.copyFile(file, destPath)

				operations.push({
					type: 'artifact',
					source: file,
					destination: destPath,
					timestamp,
				})

				console.log(`[Ratchet] Artifact promoted: ${relativePath}`)
			}
		} catch (error) {
			if (error.code !== 'ENOENT') {
				console.error('[Ratchet] Error moving artifacts:', error.message)
			}
		}

		return operations
	}

	/**
	 * Recursively get all files in a directory
	 */
	async _getFiles(dir) {
		const files = []

		try {
			const entries = await fs.readdir(dir, { withFileTypes: true })

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name)

				if (entry.isDirectory()) {
					const subFiles = await this._getFiles(fullPath)
					files.push(...subFiles)
				} else {
					files.push(fullPath)
				}
			}
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error
			}
		}

		return files
	}

	/**
	 * Create a snapshot of ratcheted items
	 */
	async createSnapshot(operations, timestamp) {
		const snapshotPath = path.join(
			this.permanentTestsDir,
			`ratchet-${timestamp}.json`
		)

		const snapshot = {
			timestamp,
			operations,
			count: operations.length,
		}

		await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8')

		console.log(`[Ratchet] Snapshot saved: ${snapshotPath}`)

		return snapshotPath
	}

	/**
	 * Clean project tests directory after ratcheting
	 */
	async cleanProjectTests() {
		try {
			await fs.rm(this.projectTestsDir, { recursive: true, force: true })
			console.log('[Ratchet] Project tests directory cleaned')
		} catch (error) {
			console.error('[Ratchet] Error cleaning project tests:', error.message)
		}
	}
}

