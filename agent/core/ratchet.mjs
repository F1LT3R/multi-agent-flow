import fs from 'fs/promises'
import path from 'path'

/**
 * Ratchet System
 * Manages the lifecycle of "blessed" artifacts (tests, stories, reports)
 *
 * Order of Operations:
 *
 * PRE-RUN (before Docker starts):
 *   1. Clean orphaned .new.test.* files (from previous abandoned runs)
 *   2. Copy .flow/ratchet/tests/ → project root (chmod 444)
 *      - If empty/missing, skip (first run scenario)
 *   3. Read .flow/ratchet/stories/ for orchestrator injection
 *
 * POST-RUN SUCCESS:
 *   4. Promote .new.test.* files (rename, remove .new.)
 *   5. Copy ALL tests from project root → .flow/ratchet/tests/
 *   6. Write stories to .flow/ratchet/stories/
 *   7. Write reports to .flow/ratchet/reports/
 *   8. Atomic: all promotions succeed or none do
 *
 * POST-RUN FAILURE/REFLOW:
 *   - Keep .new.test.* files (agent can iterate)
 *   - Keep all artifacts in place for investigation
 *   - Don't update ratchet
 */
export class Ratchet {
	constructor(projectRoot = process.cwd()) {
		this.projectRoot = projectRoot
		this.ratchetDir = path.join(projectRoot, '.flow/ratchet')
		this.testsRatchet = path.join(this.ratchetDir, 'tests')
		this.storiesRatchet = path.join(this.ratchetDir, 'stories')
		this.reportsRatchet = path.join(this.ratchetDir, 'reports')
	}

	/**
	 * Prepare for a new run
	 * Called by flow-runner BEFORE Docker starts
	 */
	async prepareRun(isNewRun = false) {
		console.log('[Ratchet] Preparing for run...')

		// Step 1: Clean orphaned .new.test.* files on new runs only
		if (isNewRun) {
			await this._cleanOrphanedNewTests()
		}

		// Step 2: Copy ratcheted tests to project root (chmod 444)
		const testsCopied = await this._copyTestsToProject()

		// Step 3: Read stories for orchestrator (returned to caller)
		const stories = await this._readStories()

		console.log(`[Ratchet] Preparation complete. ${testsCopied} tests staged.`)

		return {
			testsCopied,
			stories,
		}
	}

	/**
	 * Finalize after successful run
	 * Called by flow-runner on SUCCESS
	 */
	async finalizeSuccess() {
		console.log('[Ratchet] Finalizing successful run...')

		const operations = []

		// Step 4: Promote .new.test.* files
		const promoted = await this._promoteNewTests()
		operations.push(...promoted)

		// Step 5: Copy ALL tests from project to ratchet
		const ratcheted = await this._ratchetTests()
		operations.push(...ratcheted)

		// Note: Stories and reports are saved by flow-runner directly
		// to .flow/ratchet/stories/ and .flow/ratchet/reports/

		console.log(`[Ratchet] Success finalization complete. ${operations.length} operations.`)

		return {
			success: true,
			operations,
		}
	}

	/**
	 * Finalize after failed run or reflow
	 * Called by flow-runner on FAILURE
	 */
	async finalizeFailure() {
		console.log('[Ratchet] Keeping artifacts for investigation...')

		// Do nothing - keep all .new.test.* files and artifacts in place
		// This allows agents to iterate on failures in reflow

		return {
			success: true,
			message: 'Artifacts preserved for investigation',
		}
	}

	/**
	 * Find all .new.test.* files in project (public wrapper)
	 * @returns {Promise<string[]>} Array of file paths
	 */
	async findNewTestFiles() {
		return this._findNewTestFiles(this.projectRoot)
	}

	/**
	 * Finalize with user-approved changes only
	 * @param {Object} decisions - User decisions from approval dialog
	 * @param {string[]} decisions.approved - Files to promote and ratchet
	 * @param {string[]} decisions.rejected - Files to delete
	 * @param {string[]} decisions.skipped - Files to leave in place
	 */
	async finalizeWithApprovals({ approved = [], rejected = [], skipped = [] }) {
		console.log('[Ratchet] Finalizing with user approvals...')

		const operations = []

		// Promote only approved files
		for (const file of approved) {
			const newName = file.replace('.new.test.', '.test.')

			try {
				// Remove old file if exists (was read-only ratcheted test)
				try {
					await fs.chmod(newName, 0o644)
					await fs.unlink(newName)
				} catch (e) {
					// File didn't exist, that's fine
				}

				// Rename the .new. file
				await fs.rename(file, newName)

				operations.push({
					type: 'promote',
					from: path.relative(this.projectRoot, file),
					to: path.relative(this.projectRoot, newName),
				})

				console.log(`[Ratchet] Promoted: ${path.basename(file)} → ${path.basename(newName)}`)
			} catch (error) {
				console.error(`[Ratchet] Failed to promote ${file}: ${error.message}`)
				throw error
			}
		}

		// Delete rejected files
		for (const file of rejected) {
			try {
				await fs.unlink(file)
				operations.push({
					type: 'reject',
					file: path.relative(this.projectRoot, file),
				})
				console.log(`[Ratchet] Deleted rejected: ${path.basename(file)}`)
			} catch (error) {
				console.error(`[Ratchet] Failed to delete ${file}: ${error.message}`)
			}
		}

		// Skipped files are left in place - no action needed
		for (const file of skipped) {
			console.log(`[Ratchet] Skipped (kept): ${path.basename(file)}`)
		}

		// Ratchet all current test files (including newly promoted ones)
		const ratcheted = await this._ratchetTests()
		operations.push(...ratcheted)

		console.log(`[Ratchet] Approval finalization complete. ${operations.length} operations.`)

		return {
			success: true,
			operations,
			summary: {
				approved: approved.length,
				rejected: rejected.length,
				skipped: skipped.length,
			},
		}
	}

	/**
	 * Clean orphaned .new.test.* files from previous abandoned runs
	 * Only called on NEW runs (not reflows)
	 */
	async _cleanOrphanedNewTests() {
		console.log('[Ratchet] Cleaning orphaned .new.test.* files...')

		const newTestFiles = await this._findNewTestFiles(this.projectRoot)

		for (const file of newTestFiles) {
			try {
				await fs.unlink(file)
				console.log(`[Ratchet] Cleaned orphan: ${path.relative(this.projectRoot, file)}`)
			} catch (error) {
				console.error(`[Ratchet] Failed to clean ${file}: ${error.message}`)
			}
		}

		return newTestFiles.length
	}

	/**
	 * Copy ratcheted tests to project root (read-only)
	 */
	async _copyTestsToProject() {
		let count = 0

		try {
			await fs.access(this.testsRatchet)
		} catch (error) {
			// First run - no ratcheted tests yet
			console.log('[Ratchet] No ratcheted tests found (first run)')
			return 0
		}

		const testFiles = await this._getFiles(this.testsRatchet, '.test.mjs')

		for (const file of testFiles) {
			const relativePath = path.relative(this.testsRatchet, file)
			const destPath = path.join(this.projectRoot, relativePath)

			try {
				// Create directory if needed
				await fs.mkdir(path.dirname(destPath), { recursive: true })

				// Copy file
				await fs.copyFile(file, destPath)

				// Set read-only (chmod 444)
				await fs.chmod(destPath, 0o444)

				count++
				console.log(`[Ratchet] Staged (ro): ${relativePath}`)
			} catch (error) {
				console.error(`[Ratchet] Failed to stage ${relativePath}: ${error.message}`)
			}
		}

		return count
	}

	/**
	 * Read stories from ratchet for orchestrator injection
	 */
	async _readStories() {
		const stories = {}

		try {
			await fs.access(this.storiesRatchet)
		} catch (error) {
			// No stories yet
			return stories
		}

		const storyFiles = await this._getFiles(this.storiesRatchet, '.md')

		for (const file of storyFiles) {
			const name = path.basename(file, '.md')
			try {
				stories[name] = await fs.readFile(file, 'utf-8')
			} catch (error) {
				console.error(`[Ratchet] Failed to read story ${name}: ${error.message}`)
			}
		}

		return stories
	}

	/**
	 * Promote .new.test.* files by removing .new. from the name
	 */
	async _promoteNewTests() {
		const operations = []
		const newTestFiles = await this._findNewTestFiles(this.projectRoot)

		for (const file of newTestFiles) {
			// Convert .new.test.mjs to .test.mjs
			const newName = file.replace('.new.test.', '.test.')

			try {
				// Remove old file if exists (was read-only ratcheted test)
				try {
					await fs.chmod(newName, 0o644) // Make writable first
					await fs.unlink(newName)
				} catch (e) {
					// File didn't exist, that's fine
				}

				// Rename the .new. file
				await fs.rename(file, newName)

				operations.push({
					type: 'promote',
					from: path.relative(this.projectRoot, file),
					to: path.relative(this.projectRoot, newName),
				})

				console.log(`[Ratchet] Promoted: ${path.basename(file)} → ${path.basename(newName)}`)
			} catch (error) {
				console.error(`[Ratchet] Failed to promote ${file}: ${error.message}`)
				throw error // Atomic: fail all if one fails
			}
		}

		return operations
	}

	/**
	 * Ratchet all test files from project to .flow/ratchet/tests/
	 */
	async _ratchetTests() {
		const operations = []

		// Ensure ratchet tests directory exists
		await fs.mkdir(this.testsRatchet, { recursive: true })

		// Find all test files in project (excluding .flow/)
		const testFiles = await this._getFiles(this.projectRoot, '.test.mjs', ['.flow'])

		for (const file of testFiles) {
			const relativePath = path.relative(this.projectRoot, file)
			const destPath = path.join(this.testsRatchet, relativePath)

			try {
				// Create directory if needed
				await fs.mkdir(path.dirname(destPath), { recursive: true })

				// Make source writable first (in case it was read-only)
				try {
					await fs.chmod(file, 0o644)
				} catch (e) {
					// Ignore chmod errors
				}

				// Copy to ratchet
				await fs.copyFile(file, destPath)

				operations.push({
					type: 'ratchet',
					source: relativePath,
					destination: path.relative(this.projectRoot, destPath),
				})

				console.log(`[Ratchet] Ratcheted: ${relativePath}`)
			} catch (error) {
				console.error(`[Ratchet] Failed to ratchet ${relativePath}: ${error.message}`)
				throw error // Atomic: fail all if one fails
			}
		}

		return operations
	}

	/**
	 * Find all .new.test.* files in directory
	 */
	async _findNewTestFiles(dir, excludeDirs = ['.flow', 'node_modules']) {
		const files = []

		try {
			const entries = await fs.readdir(dir, { withFileTypes: true })

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name)

				if (entry.isDirectory()) {
					if (!excludeDirs.includes(entry.name)) {
						const subFiles = await this._findNewTestFiles(fullPath, excludeDirs)
						files.push(...subFiles)
					}
				} else if (entry.name.includes('.new.test.')) {
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
	 * Recursively get files with specific extension
	 */
	async _getFiles(dir, extension = null, excludeDirs = []) {
		const files = []

		try {
			const entries = await fs.readdir(dir, { withFileTypes: true })

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name)

				if (entry.isDirectory()) {
					if (!excludeDirs.includes(entry.name)) {
						const subFiles = await this._getFiles(fullPath, extension, excludeDirs)
						files.push(...subFiles)
					}
				} else if (!extension || entry.name.endsWith(extension)) {
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
	 * Save stories to ratchet (called by orchestrator)
	 */
	async saveStories(stories) {
		await fs.mkdir(this.storiesRatchet, { recursive: true })

		for (const [name, content] of Object.entries(stories)) {
			const filePath = path.join(this.storiesRatchet, `${name}.md`)
			await fs.writeFile(filePath, content, 'utf-8')
			console.log(`[Ratchet] Saved story: ${name}.md`)
		}
	}

	/**
	 * Get all ratcheted stories
	 */
	async getStories() {
		return this._readStories()
	}

	/**
	 * Find test files that differ from their ratcheted versions
	 * Used by manual `flow ratchet tests` command
	 * @returns {Promise<Array<{file: string, relativePath: string, isNew: boolean}>>}
	 */
	async findChangedTests() {
		const projectTests = await this._getFiles(this.projectRoot, '.test.mjs', ['.flow', 'node_modules'])
		const changed = []

		for (const file of projectTests) {
			// Skip .new.test. files - those are handled separately
			if (file.includes('.new.test.')) {
				continue
			}

			const relativePath = path.relative(this.projectRoot, file)
			const ratchetPath = path.join(this.testsRatchet, relativePath)

			const projectContent = await fs.readFile(file, 'utf-8')
			let ratchetContent = null
			try {
				ratchetContent = await fs.readFile(ratchetPath, 'utf-8')
			} catch {
				// File doesn't exist in ratchet - it's new
			}

			if (projectContent !== ratchetContent) {
				changed.push({ file, relativePath, isNew: ratchetContent === null })
			}
		}

		return changed
	}

	/**
	 * Run tests in project directory
	 * @returns {Promise<{success: boolean, output?: string, error?: string}>}
	 */
	async runTests() {
		const { exec } = await import('child_process')
		const { promisify } = await import('util')
		const execAsync = promisify(exec)

		try {
			const { stdout, stderr } = await execAsync('node --test --test-reporter=spec *.test.mjs', {
				cwd: this.projectRoot,
				timeout: 60000, // 60 second timeout
			})
			return { success: true, output: stdout + stderr }
		} catch (error) {
			return {
				success: false,
				error: error.message,
				output: error.stdout + error.stderr,
			}
		}
	}

	/**
	 * Ratchet only the specified changed test files
	 * @param {Array<{file: string, relativePath: string}>} files - Files to ratchet
	 * @returns {Promise<Array<{type: string, source: string, destination: string}>>}
	 */
	async ratchetChangedTests(files) {
		const operations = []

		// Ensure ratchet tests directory exists
		await fs.mkdir(this.testsRatchet, { recursive: true })

		for (const { file, relativePath } of files) {
			const destPath = path.join(this.testsRatchet, relativePath)

			try {
				// Create directory if needed
				await fs.mkdir(path.dirname(destPath), { recursive: true })

				// Make source writable first (in case it was read-only)
				try {
					await fs.chmod(file, 0o644)
				} catch {
					// Ignore chmod errors
				}

				// Copy to ratchet
				await fs.copyFile(file, destPath)

				operations.push({
					type: 'ratchet',
					source: relativePath,
					destination: path.relative(this.projectRoot, destPath),
				})
			} catch (error) {
				throw new Error(`Failed to ratchet ${relativePath}: ${error.message}`)
			}
		}

		return operations
	}

	/**
	 * Find test files that exist in ratchet but were deleted from project
	 * @returns {Promise<Array<{file: string, relativePath: string}>>}
	 */
	async findDeletedTests() {
		const deleted = []

		try {
			await fs.access(this.testsRatchet)
		} catch {
			return deleted // No ratchet dir yet
		}

		const ratchetTests = await this._getFiles(this.testsRatchet, '.test.mjs')

		for (const file of ratchetTests) {
			const relativePath = path.relative(this.testsRatchet, file)
			const projectPath = path.join(this.projectRoot, relativePath)

			try {
				await fs.access(projectPath)
			} catch {
				// File doesn't exist in project - it was deleted
				deleted.push({ file, relativePath })
			}
		}

		return deleted
	}

	/**
	 * Delete specified test files from the ratchet directory
	 * @param {Array<{file: string, relativePath: string}>} files - Files to delete
	 * @returns {Promise<number>} Number of files deleted
	 */
	async deleteRatchetedTests(files) {
		let count = 0

		for (const { file } of files) {
			try {
				await fs.unlink(file)
				count++
			} catch (error) {
				console.error(`[Ratchet] Failed to delete ${file}: ${error.message}`)
			}
		}

		return count
	}
}
