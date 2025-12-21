/**
 * Unit tests for prompt-based tool parser
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { parseToolCommands, formatToolResults } from '../vm-tools/prompt-tool-parser.mjs'

test('parseToolCommands - single WRITE_FILE command', () => {
	const content = `
Here's the mockup:

\`\`\`WRITE_FILE
path: mockup-homepage.html
content:
<!DOCTYPE html>
<html>
  <head><title>Test</title></head>
  <body><h1>Hello</h1></body>
</html>
\`\`\`

Done!
`

	const commands = parseToolCommands(content)
	
	assert.strictEqual(commands.length, 1)
	assert.strictEqual(commands[0].name, 'write_file')
	assert.strictEqual(commands[0].args.path, 'mockup-homepage.html')
	assert.ok(commands[0].args.content.includes('<!DOCTYPE html>'))
	assert.ok(commands[0].args.content.includes('<h1>Hello</h1>'))
})

test('parseToolCommands - multiple commands', () => {
	const content = `
First, let me list the directory:

\`\`\`LIST_DIRECTORY
path: .
\`\`\`

Then read a file:

\`\`\`READ_FILE
path: existing-file.js
\`\`\`
`

	const commands = parseToolCommands(content)
	
	assert.strictEqual(commands.length, 2)
	assert.strictEqual(commands[0].name, 'list_directory')
	assert.strictEqual(commands[0].args.path, '.')
	assert.strictEqual(commands[1].name, 'read_file')
	assert.strictEqual(commands[1].args.path, 'existing-file.js')
})

test('parseToolCommands - command with no arguments', () => {
	const content = `
\`\`\`INSTALL_DEPENDENCIES
\`\`\`
`

	const commands = parseToolCommands(content)
	
	assert.strictEqual(commands.length, 1)
	assert.strictEqual(commands[0].name, 'install_dependencies')
	assert.deepStrictEqual(commands[0].args, {})
})

test('parseToolCommands - multi-line content value', () => {
	const content = `
\`\`\`WRITE_FILE
path: test.js
content:
function hello() {
  console.log('Hello, World!')
}

export { hello }
\`\`\`
`

	const commands = parseToolCommands(content)
	
	assert.strictEqual(commands.length, 1)
	assert.strictEqual(commands[0].args.path, 'test.js')
	assert.ok(commands[0].args.content.includes('function hello()'))
	assert.ok(commands[0].args.content.includes('export { hello }'))
})

test('parseToolCommands - ignores non-uppercase code blocks', () => {
	const content = `
Here's some code:

\`\`\`javascript
const x = 5
\`\`\`

And a command:

\`\`\`WRITE_FILE
path: test.txt
content: Hello
\`\`\`
`

	const commands = parseToolCommands(content)
	
	assert.strictEqual(commands.length, 1)
	assert.strictEqual(commands[0].name, 'write_file')
})

test('parseToolCommands - handles empty content', () => {
	const content = 'No commands here!'
	
	const commands = parseToolCommands(content)
	
	assert.strictEqual(commands.length, 0)
})

test('formatToolResults - successful result', () => {
	const results = [
		{
			command: 'write_file',
			success: true,
			result: 'File written successfully',
			args: { path: 'test.txt' }
		}
	]
	
	const formatted = formatToolResults(results)
	
	assert.ok(formatted.includes('✓'))
	assert.ok(formatted.includes('write_file'))
	assert.ok(formatted.includes('succeeded'))
})

test('formatToolResults - failed result', () => {
	const results = [
		{
			command: 'read_file',
			success: false,
			error: 'File not found',
			args: { path: 'missing.txt' }
		}
	]
	
	const formatted = formatToolResults(results)
	
	assert.ok(formatted.includes('✗'))
	assert.ok(formatted.includes('read_file'))
	assert.ok(formatted.includes('failed'))
	assert.ok(formatted.includes('File not found'))
})

test('formatToolResults - array result (directory listing)', () => {
	const results = [
		{
			command: 'list_directory',
			success: true,
			result: ['file1.js', 'file2.js', 'README.md'],
			args: { path: '.' }
		}
	]
	
	const formatted = formatToolResults(results)
	
	assert.ok(formatted.includes('file1.js'))
	assert.ok(formatted.includes('file2.js'))
	assert.ok(formatted.includes('README.md'))
})

test('formatToolResults - long string result gets truncated', () => {
	const longContent = 'x'.repeat(1000)
	const results = [
		{
			command: 'read_file',
			success: true,
			result: longContent,
			args: { path: 'large.txt' }
		}
	]
	
	const formatted = formatToolResults(results)
	
	assert.ok(formatted.includes('[truncated]'))
	assert.ok(formatted.length < longContent.length + 200)
})

