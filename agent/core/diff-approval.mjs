/**
 * Diff Approval Module
 * Interactive approval for test file changes before ratcheting
 */
import { execSync } from 'child_process'
import readline from 'readline'
import chalk from 'chalk'
import fs from 'fs/promises'
import path from 'path'

/**
 * Generate a unified diff between two files
 * @param {string} originalPath - Path to original file (may not exist for new files)
 * @param {string} newPath - Path to new file
 * @returns {string} Diff output
 */
export function generateDiff(originalPath, newPath) {
	try {
		// Check if original exists
		try {
			execSync(`test -f "${originalPath}"`, { stdio: 'ignore' })
		} catch {
			// Original doesn't exist - show entire new file as additions
			try {
				const content = execSync(`cat "${newPath}"`, { encoding: 'utf-8' })
				const lines = content.split('\n').map(line => chalk.green(`+${line}`)).join('\n')
				return `${chalk.bold('--- (new file)')}\n${chalk.bold(`+++ ${path.basename(newPath)}`)}\n${lines}`
			} catch {
				return '(unable to read file)'
			}
		}

		// Both files exist - generate diff
		const diff = execSync(`diff -u "${originalPath}" "${newPath}" || true`, { encoding: 'utf-8' })
		
		if (!diff.trim()) {
			return '(no differences)'
		}

		// Colorize the diff output
		return diff.split('\n').map(line => {
			if (line.startsWith('+++') || line.startsWith('---')) {
				return chalk.bold(line)
			} else if (line.startsWith('+')) {
				return chalk.green(line)
			} else if (line.startsWith('-')) {
				return chalk.red(line)
			} else if (line.startsWith('@@')) {
				return chalk.cyan(line)
			}
			return line
		}).join('\n')
	} catch (error) {
		return `(diff error: ${error.message})`
	}
}

/**
 * Prompt user for approval of test file changes
 * @param {string[]} newFiles - Array of .new.test.* file paths
 * @param {string} ratchetDir - Path to ratchet tests directory
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<{approved: string[], rejected: string[], skipped: string[]}>}
 */
export async function promptForApproval(newFiles, ratchetDir, projectRoot) {
	const approved = []
	const rejected = []
	const skipped = []

	if (newFiles.length === 0) {
		return { approved, rejected, skipped }
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve))

	console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════════'))
	console.log(chalk.bold.cyan(`  Test changes require approval (${newFiles.length} file${newFiles.length > 1 ? 's' : ''})`))
	console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════\n'))

	let acceptAll = false

	for (let i = 0; i < newFiles.length; i++) {
		const newFile = newFiles[i]
		const relativePath = path.relative(projectRoot, newFile)
		
		// Determine the original file path (remove .new. from the name)
		const originalName = path.basename(newFile).replace('.new.test.', '.test.')
		const originalInRatchet = path.join(ratchetDir, originalName)
		const originalInProject = path.join(path.dirname(newFile), originalName)

		// Try ratchet first, then project root
		let originalPath = originalInRatchet
		try {
			await fs.access(originalInRatchet)
		} catch {
			originalPath = originalInProject
		}

		console.log(chalk.bold.white(`\n[${i + 1}/${newFiles.length}] ${relativePath}\n`))

		// Generate and display diff
		const diff = generateDiff(originalPath, newFile)
		console.log(diff)
		console.log()

		if (acceptAll) {
			console.log(chalk.green('Auto-accepted (accept-all mode)'))
			approved.push(newFile)
			continue
		}

		// Prompt for action
		const answer = await question(
			chalk.yellow('[A]ccept  [R]eject  [S]kip  [a]ccept-all  [q]uit: ')
		)

		const choice = answer.trim().toLowerCase()

		switch (choice) {
			case 'a':
			case 'accept':
				approved.push(newFile)
				console.log(chalk.green('✓ Accepted'))
				break
			case 'r':
			case 'reject':
				rejected.push(newFile)
				console.log(chalk.red('✗ Rejected'))
				break
			case 's':
			case 'skip':
				skipped.push(newFile)
				console.log(chalk.yellow('⊘ Skipped'))
				break
			case 'accept-all':
				acceptAll = true
				approved.push(newFile)
				console.log(chalk.green('✓ Accepted (will auto-accept remaining)'))
				break
			case 'q':
			case 'quit':
				// Skip all remaining
				for (let j = i; j < newFiles.length; j++) {
					skipped.push(newFiles[j])
				}
				console.log(chalk.yellow(`Skipped ${newFiles.length - i} remaining file(s)`))
				rl.close()
				return { approved, rejected, skipped }
			default:
				// Default to skip if invalid input
				skipped.push(newFile)
				console.log(chalk.yellow('⊘ Skipped (invalid input)'))
		}
	}

	rl.close()

	// Summary
	console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════════'))
	console.log(chalk.bold.cyan('  Summary'))
	console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════'))
	console.log(chalk.green(`  Accepted: ${approved.length}`))
	console.log(chalk.red(`  Rejected: ${rejected.length}`))
	console.log(chalk.yellow(`  Skipped:  ${skipped.length}`))
	console.log()

	return { approved, rejected, skipped }
}

