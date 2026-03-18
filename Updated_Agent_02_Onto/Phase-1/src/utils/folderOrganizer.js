/**
 * Folder Organizer Utility
 * Organizes generated artifacts into logical folders
 */

import { join } from 'path';
import { mkdir } from 'fs/promises';
import config from '../config/index.js';

/**
 * Get organized folder paths for a fileId
 */
export function getOrganizedPaths(fileId) {
    const baseDir = join(config.storage.artifactsDir, fileId);
    
    return {
        base: baseDir,
        json: join(baseDir, 'json'),
        dbml: join(baseDir, 'dbml'),
        logical: join(baseDir, 'logical'),
        physical: join(baseDir, 'physical'),
        executive: join(baseDir, 'executive')
    };
}

/**
 * Ensure all organized folders exist
 */
export async function ensureFolders(fileId) {
    const paths = getOrganizedPaths(fileId);
    
    await Promise.all([
        mkdir(paths.json, { recursive: true }),
        mkdir(paths.dbml, { recursive: true }),
        mkdir(paths.logical, { recursive: true }),
        mkdir(paths.physical, { recursive: true }),
        mkdir(paths.executive, { recursive: true })
    ]);
    
    return paths;
}

