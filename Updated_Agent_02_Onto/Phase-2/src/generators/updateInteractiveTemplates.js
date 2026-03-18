/**
 * Script to update InteractiveHTML.js generator methods
 * to use the template structure from physical_INTERACTIVE.html and logical_INTERACTIVE.html
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This script will be used to update the generator
// For now, we'll update the generator methods directly

console.log('Template update script - use this to update InteractiveHTML.js');
