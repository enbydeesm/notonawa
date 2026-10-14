// Asking for a secret on the command line without showing what's typed.

import readline from "node:readline";

/**
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Show the prompt, then nothing of what's typed.
    let prompted = false;
    /** @type {any} */ (rl)._writeToOutput = (/** @type {string} */ text) => {
      if (!prompted) {
        process.stdout.write(text);
        prompted = true;
      }
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}
