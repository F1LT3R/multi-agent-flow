# VM Isolation Architecture

This document describes the security isolation architecture used in Multi-Agent Flow to ensure agents operate safely within a controlled environment.

## Overview

All agent execution happens **inside a Docker container**, providing kernel-level isolation from the host system. Agents interact with the project filesystem exclusively through MCP-like tools (`vm-tools`) that enforce strict path validation. This multi-layered approach ensures that even prompt-injected agents cannot escape their sandbox.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              HOST SYSTEM                                │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                          FlowRunner                               │  │
│  │  ┌─────────────────┐    ┌─────────────────┐                       │  │
│  │  │ DockerManager   │───▶│ Security Checks │                       │  │
│  │  └─────────────────┘    │ (SEC-01..SEC-07)│                       │  │
│  │           │             └────────┬────────┘                       │  │
│  │           │                      │ ALL PASS                       │  │
│  │           ▼                      ▼                                │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │                    DOCKER CONTAINER                         │  │  │
│  │  │  ┌─────────────────────────────────────────────────────────┐│  │  │
│  │  │  │                   Agent Script                          ││  │  │
│  │  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ││  │  │
│  │  │  │  │ AI Provider  │  │   vm-tools   │  │Path Validation│  ││  │  │
│  │  │  │  │    SDK       │  │  (MCP-like)  │──│   Layer      │  ││  │  │
│  │  │  │  └──────────────┘  └──────┬───────┘  └──────┬───────┘  ││  │  │
│  │  │  └───────────────────────────┼─────────────────┼──────────┘│  │  │
│  │  │                              │                 │           │  │  │
│  │  │  ┌───────────────────────────▼─────────────────▼─────────┐ │  │  │
│  │  │  │                     /project (RW)                     │ │  │  │
│  │  │  │                  (User's project files)               │ │  │  │
│  │  │  └───────────────────────────────────────────────────────┘ │  │  │
│  │  │                                                            │  │  │
│  │  │  ┌───────────────────────────────────────────────────────┐ │  │  │
│  │  │  │               /workspace/agent (Built-in)             │ │  │  │
│  │  │  │            (Agent code, AI SDKs, vm-tools)            │ │  │  │
│  │  │  └───────────────────────────────────────────────────────┘ │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Security Layers

The isolation architecture consists of multiple defense layers:

### Layer 1: Docker Container Isolation

- Agent code runs inside a Docker container
- Only the user's project directory is mounted (`/project`)
- Host filesystem is not accessible
- Network access is available only for AI API calls
- Container runs as non-root user

### Layer 2: Path Validation (vm-tools)

All file operations go through `vm-tools/file-operations.mjs` which enforces:

| Rule | Implementation |
|------|----------------|
| Block absolute paths | Reject paths starting with `/` |
| Block parent traversal | Reject paths containing `..` |
| Block symlink escapes | Use `fs.realpath()` to resolve symlinks before validation |
| Block protected directories | Reject access to `.flow/` |
| Protect ratcheted tests | Reject writes to read-only (chmod 444) files |

### Layer 3: Pre-Run Security Validation

Before any agent executes, the `FlowRunner` runs 7 active security checks:

| Check ID | Test | Expected Result |
|----------|------|-----------------|
| SEC-01 | Container running | State.Running === true |
| SEC-02 | Mount /project exists | Mount present with RW |
| SEC-03 | Write to `/tmp/escape.txt` | BLOCKED (absolute path) |
| SEC-04 | Write to `../escape.txt` | BLOCKED (parent traversal) |
| SEC-05 | Write to `a/b/../../../escape.txt` | BLOCKED (nested traversal) |
| SEC-06 | Write to `.flow/breach.txt` | BLOCKED (protected dir) |
| SEC-07 | Write to `allowed.txt` | ALLOWED (sanity check) |

**If any check fails, the container is immediately terminated.**

### Security Check Output

When the flow starts, you'll see the security validation box:

```
╔════════════════════════════════════════════════════════════════╗
║                      SECURITY VALIDATION                       ║
╠════════════════════════════════════════════════════════════════╣
║  [SEC-01] Container running ................................ [PASS] ║
║  [SEC-02] Mount /project verified .......................... [PASS] ║
║  [SEC-03] Absolute path blocked ............................ [PASS] ║
║  [SEC-04] Parent traversal blocked ......................... [PASS] ║
║  [SEC-05] Nested traversal blocked ......................... [PASS] ║
║  [SEC-06] Protected dir (.flow/) blocked ................... [PASS] ║
║  [SEC-07] Valid write allowed .............................. [PASS] ║
╠════════════════════════════════════════════════════════════════╣
║  ALL SECURITY CHECKS PASSED - Agents may proceed               ║
╚════════════════════════════════════════════════════════════════╝
```

On security breach detection:

```
╔════════════════════════════════════════════════════════════════╗
║  *** SECURITY VIOLATION DETECTED ***                           ║
╠════════════════════════════════════════════════════════════════╣
║  SEC-04: Write escape succeeded with path "../escape.txt"      ║
║  Container terminated immediately.                              ║
╚════════════════════════════════════════════════════════════════╝
```

## Escape Vector Coverage

| Escape Vector | Protection Layer | Check ID |
|---------------|------------------|----------|
| Absolute paths (`/tmp/file`) | Path validation | SEC-03 |
| Parent traversal (`../file`) | Path validation | SEC-04 |
| Nested traversal (`a/../../../file`) | Path validation | SEC-05 |
| Protected directories (`.flow/`) | Path validation | SEC-06 |
| Symlinks to outside `/project` | `fs.realpath()` resolution | Path validation |
| Host filesystem access | Docker mount isolation | SEC-02 |
| Container escape | Docker kernel isolation | Docker |

## Available Tools

Agents can only interact with the filesystem through these MCP-like tools:

| Tool | Description | Write Access |
|------|-------------|--------------|
| `read_file` | Read file contents | No |
| `write_file` | Write file contents | Yes (validated) |
| `list_directory` | List directory contents | No |
| `delete_file` | Delete a file | Yes (validated) |
| `move_file` | Move/rename a file | Yes (validated) |
| `grep` | Search for patterns | No |
| `run_node_tests` | Execute Node.js tests | No |
| `run_puppeteer` | Execute browser tests | No |
| `lint_code` | Run ESLint | No |
| `check_style` | Check formatting | No |

## Protected Paths

The following paths are protected from agent access:

| Path | Protection | Reason |
|------|------------|--------|
| `.flow/` | Blocked entirely | Contains prompts, config, checkpoints, traces |
| `*.test.mjs` (chmod 444) | Read-only | Ratcheted tests cannot be modified |
| Absolute paths | Blocked | Prevents access outside `/project` |
| Parent directories (`..`) | Blocked | Prevents traversal attacks |

## Implementation Files

| File | Role |
|------|------|
| `agent/core/flow-runner.mjs` | Runs security checks via `_runSecurityChecks()` |
| `agent/core/docker-manager.mjs` | Manages container lifecycle and mounts |
| `agent/vm-tools/file-operations.mjs` | Path validation with symlink protection |
| `agent/vm-tools/index.mjs` | Tool registry and dispatcher |
| `agent/docker/Dockerfile` | Container image with agent code |

## Summary

| Aspect | Status |
|--------|--------|
| Agent code runs in Docker container | Yes |
| No host-side agent executor | Yes (removed) |
| Tools imported directly in VM (no HTTP) | Yes |
| Absolute path blocked | Yes (SEC-03) |
| Parent traversal blocked | Yes (SEC-04) |
| Nested traversal blocked | Yes (SEC-05) |
| Protected directories (.flow/) blocked | Yes (SEC-06) |
| Symlink escape blocked | Yes (fs.realpath) |
| Ratcheted test files protected | Yes (chmod 444) |
| Only project directory mounted | Yes (SEC-02) |
| Pre-run security validation | Yes (7 checks) |
| Immediate shutdown on breach | Yes |
| AI API calls happen in VM | Yes |

## Testing the Isolation

To manually verify isolation is working, you can run the security checks by starting any flow:

```bash
npx multi-agent-flow dev "test task"
```

The security validation box will appear before any agent executes. If you modify the vm-tools to bypass validation, the active escape tests (SEC-03 through SEC-07) will detect the breach and terminate the container.
