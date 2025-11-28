import { add } from '../calculator.js';
import { test, describe, expect } from 'vitest';

describe('Calculator', () => {
	describe('add', () => {
		it('should return the sum of two numbers', () => {
			expect(add(2, 3)).toBe(5);
			expect(add(2.5, 3.5)).toBe(6);
			expect(add(-1, 1)).toBe(0);
		});

		it('should throw an error if inputs are not numbers', () => {
			expect(() => add('2', 3)).toThrow('Both inputs must be numbers.');
			expect(() => add(2, null)).toThrow('Both inputs must be numbers.');
			expect(() => add(undefined, 3)).toThrow('Both inputs must be numbers.');
		});
	});
});