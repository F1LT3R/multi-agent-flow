# Simple Calculator

This is a simple calculator module with an `add` function that can add two numbers together.

## Features
- Add two numbers (supports both integers and floating-point numbers).
- Input validation to ensure that both inputs are numbers.
- Handles precision issues with floating-point arithmetic.

## Usage
```javascript
import { add } from './calculator.js';

const result = add(5, 3);
console.log(result); // Output: 8
```

## Error Handling
The `add` function will throw an error if any of the inputs are not numbers.

## Running Tests
1. Install dependencies: `npm install`
2. Run tests: `npm test`
