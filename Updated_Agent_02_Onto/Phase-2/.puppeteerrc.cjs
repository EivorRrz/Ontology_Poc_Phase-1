// Puppeteer configuration for Mermaid CLI
// This tells Mermaid CLI to use Microsoft Edge instead of downloading Chrome

const { join } = require('path');

module.exports = {
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ]
};

