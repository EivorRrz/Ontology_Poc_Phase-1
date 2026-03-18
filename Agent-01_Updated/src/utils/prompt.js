/**
 * Console prompt utility for user input
 */

import readline from 'readline';

/**
 * Create readline interface
 */
function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Ask user a yes/no question
 * @param {string} question - Question to ask
 * @returns {Promise<boolean>} - True if yes, false if no
 */
export function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = createInterface();
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Ask user a question and return the answer
 * @param {string} question - Question to ask
 * @returns {Promise<string>} - User's answer
 */
export function askQuestion(question) {
  return new Promise((resolve) => {
    const rl = createInterface();
    rl.question(`${question}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

