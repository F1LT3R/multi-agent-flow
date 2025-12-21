/**
 * Circular Buffer for Stream Data
 * Efficiently stores the latest N characters for display in the HUD
 */
export class StreamBuffer {
	constructor(maxSize = 1024) {
		this.maxSize = maxSize
		this.buffer = ''
		this.totalChars = 0
	}

	/**
	 * Append data to the buffer
	 * Automatically truncates to keep only the latest maxSize characters
	 */
	append(data) {
		if (!data) return

		// Convert to string and clean (remove ANSI codes, control chars)
		const cleaned = this._cleanText(String(data))

		this.buffer += cleaned
		this.totalChars += cleaned.length

		// Keep only the latest maxSize characters
		if (this.buffer.length > this.maxSize) {
			this.buffer = this.buffer.slice(-this.maxSize)
		}
	}

	/**
	 * Get a window of characters from the buffer
	 * @param {number} windowSize - Size of the window to extract
	 * @param {number} offset - Offset from the end (0 = latest chars)
	 * @returns {string} The windowed text
	 */
	getWindow(windowSize, offset = 0) {
		const start = Math.max(0, this.buffer.length - windowSize - offset)
		const end = Math.max(0, this.buffer.length - offset)
		return this.buffer.slice(start, end)
	}

	/**
	 * Get the latest N characters
	 */
	getLatest(count) {
		return this.buffer.slice(-count)
	}

	/**
	 * Get the full buffer
	 */
	getAll() {
		return this.buffer
	}

	/**
	 * Get buffer length
	 */
	length() {
		return this.buffer.length
	}

	/**
	 * Get total characters processed (including truncated)
	 */
	getTotalChars() {
		return this.totalChars
	}

	/**
	 * Clear the buffer
	 */
	clear() {
		this.buffer = ''
		this.totalChars = 0
	}

	/**
	 * Clean text by removing ANSI codes and control characters
	 * Keep only printable ASCII and basic unicode
	 */
	_cleanText(text) {
		return text
			// Remove ANSI escape codes
			.replace(/\x1b\[[0-9;]*m/g, '')
			// Remove other control characters except newline/tab
			.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
			// Replace newlines and tabs with spaces for display
			.replace(/[\n\r\t]/g, ' ')
			// Collapse multiple spaces
			.replace(/\s+/g, ' ')
	}
}
