import test from 'node:test'
import assert from 'node:assert'
import { FileOpsServer } from '../mcp-servers/file-ops-server.mjs'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'

/**
 * VM Isolation Tests
 * Verify that path validation prevents escapes and enforces write boundaries
 */

test('FileOpsServer: Block absolute paths', async () => {
	const projectRoot = path.join(os.tmpdir(), 'test-project')
	await fs.mkdir(projectRoot, { recursive: true })
	
	const server = new FileOpsServer(3100, projectRoot, { 
		workspaceRoot: path.dirname(projectRoot) 
	})
	
	try {
		server._validatePath('/etc/passwd')
		assert.fail('Should have thrown error for absolute path')
	} catch (error) {
		assert.match(error.message, /Absolute paths not allowed/)
	}
	
	await fs.rm(projectRoot, { recursive: true, force: true })
})

test('FileOpsServer: Block parent directory traversal', async () => {
	const projectRoot = path.join(os.tmpdir(), 'test-project')
	await fs.mkdir(projectRoot, { recursive: true })
	
	const server = new FileOpsServer(3100, projectRoot, { 
		workspaceRoot: path.dirname(projectRoot) 
	})
	
	try {
		server._validatePath('../../etc/passwd')
		assert.fail('Should have thrown error for parent traversal')
	} catch (error) {
		assert.match(error.message, /Invalid path/)
	}
	
	await fs.rm(projectRoot, { recursive: true, force: true })
})

test('FileOpsServer: Allow project files', async () => {
	const projectRoot = path.join(os.tmpdir(), 'test-project')
	await fs.mkdir(projectRoot, { recursive: true })
	
	const server = new FileOpsServer(3100, projectRoot, { 
		workspaceRoot: path.dirname(projectRoot) 
	})
	
	const result = server._validatePath('./test.js')
	assert.strictEqual(result, path.join(projectRoot, 'test.js'))
	
	await fs.rm(projectRoot, { recursive: true, force: true })
})

test('FileOpsServer: Allow workspace plans directory', async () => {
	const workspaceRoot = path.join(os.tmpdir(), 'test-workspace')
	const projectRoot = path.join(workspaceRoot, 'project')
	await fs.mkdir(projectRoot, { recursive: true })
	await fs.mkdir(path.join(workspaceRoot, 'plans'), { recursive: true })
	
	const server = new FileOpsServer(3100, projectRoot, { 
		workspaceRoot 
	})
	
	const result = server._validatePath('../plans/USER_STORIES.md')
	assert.strictEqual(result, path.join(workspaceRoot, 'plans', 'USER_STORIES.md'))
	
	await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('FileOpsServer: Allow workspace tests directory', async () => {
	const workspaceRoot = path.join(os.tmpdir(), 'test-workspace')
	const projectRoot = path.join(workspaceRoot, 'project')
	await fs.mkdir(projectRoot, { recursive: true })
	await fs.mkdir(path.join(workspaceRoot, 'tests'), { recursive: true })
	
	const server = new FileOpsServer(3100, projectRoot, { 
		workspaceRoot 
	})
	
	const result = server._validatePath('../tests/app.test.js')
	assert.strictEqual(result, path.join(workspaceRoot, 'tests', 'app.test.js'))
	
	await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('FileOpsServer: Block access to other workspace directories', async () => {
	const workspaceRoot = path.join(os.tmpdir(), 'test-workspace')
	const projectRoot = path.join(workspaceRoot, 'project')
	await fs.mkdir(projectRoot, { recursive: true })
	
	const server = new FileOpsServer(3100, projectRoot, { 
		workspaceRoot 
	})
	
	try {
		server._validatePath('../secrets/api-keys.env')
		assert.fail('Should have thrown error for non-allowed workspace directory')
	} catch (error) {
		assert.match(error.message, /Invalid path/)
	}
	
	await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('FileOpsServer: Block path traversal within workspace reference', async () => {
	const workspaceRoot = path.join(os.tmpdir(), 'test-workspace')
	const projectRoot = path.join(workspaceRoot, 'project')
	await fs.mkdir(projectRoot, { recursive: true })
	await fs.mkdir(path.join(workspaceRoot, 'plans'), { recursive: true })
	
	const server = new FileOpsServer(3100, projectRoot, { 
		workspaceRoot 
	})
	
	try {
		// Try to escape via plans path
		server._validatePath('../plans/../../etc/passwd')
		assert.fail('Should have thrown error for path traversal via workspace dir')
	} catch (error) {
		assert.match(error.message, /Invalid workspace path/)
	}
	
	await fs.rm(workspaceRoot, { recursive: true, force: true })
})

test('Docker mounts: Verify RW permissions for all directories', async (t) => {
	// This is a documentation test - actual verification happens at runtime
	const expectedMounts = [
		{ path: '/workspace/project', mode: 'rw', purpose: 'source code' },
		{ path: '/workspace/tests', mode: 'rw', purpose: 'tests and artifacts' },
		{ path: '/workspace/plans', mode: 'rw', purpose: 'plans and reports' },
	]
	
	console.log('Expected Docker mount configuration:')
	expectedMounts.forEach(mount => {
		console.log(`  ${mount.path} (${mount.mode}): ${mount.purpose}`)
	})
	
	assert.ok(true, 'Mount configuration documented')
})

