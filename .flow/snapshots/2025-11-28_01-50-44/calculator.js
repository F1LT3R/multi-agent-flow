// Simple Calculator Module

const add = (num1, num2) => {
	// Input validation
	if (typeof num1 !== 'number' || typeof num2 !== 'number') {
		throw new Error('Both inputs must be numbers.');
	}

	// Calculate sum
	const sum = num1 + num2;

	// Handling floating-point precision issues
	return parseFloat(sum.toFixed(10));
};

export { add };