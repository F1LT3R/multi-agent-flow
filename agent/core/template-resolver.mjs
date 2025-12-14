/**
 * Template Resolver
 * Resolves {{NAME}} placeholders in prompt templates.
 * 
 * Two types of placeholders:
 * - File-based: {{SHARED}} loads from templates/common/SHARED.md
 * - Dynamic: {{INTENT}} is injected with user's original request
 */
import fs from 'fs/promises'
import path from 'path'

/**
 * Resolve template placeholders in content
 * @param {string} content - Template content with {{NAME}} placeholders
 * @param {string} templateDir - Directory containing templates (e.g., .flow/prompts)
 * @param {string} userIntent - User's original request for {{INTENT}} placeholder
 * @returns {Promise<string>} Content with placeholders resolved
 */
export async function resolveTemplatePlaceholders(content, templateDir, userIntent = '') {
	let resolved = content
	const matches = [...content.matchAll(/\{\{(\w+)\}\}/g)]

	for (const match of matches) {
		const name = match[1]

		// Reserved dynamic placeholder - inject user intent
		if (name === 'INTENT') {
			resolved = resolved.replace(match[0], userIntent || '')
			continue
		}

		// File-based placeholder - load from common/ directory
		const commonPath = path.join(templateDir, 'common', `${name}.md`)
		try {
			let commonContent = await fs.readFile(commonPath, 'utf-8')
			// Recursively resolve placeholders in the included content
			commonContent = await resolveTemplatePlaceholders(commonContent, templateDir, userIntent)
			resolved = resolved.replace(match[0], commonContent)
		} catch (error) {
			console.error(`❌ TEMPLATE ERROR: {{${name}}} - ${error.message} (path: ${commonPath})`)
		}
	}
	return resolved
}

