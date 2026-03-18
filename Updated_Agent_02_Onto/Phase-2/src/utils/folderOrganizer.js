/**
 * Folder Organizer Utility for Phase-2
 * Organizes generated artifacts into logical folders
 */

import { join } from 'path';
import { mkdir } from 'fs/promises';
import config from '../config.js';

/**
 * Get organized folder paths for a fileId
 */
export function getOrganizedPaths(fileId) {
    const baseDir = join(config.phase1ArtifactsDir, fileId);
    
    return {
        base: baseDir,
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
        mkdir(paths.physical, { recursive: true }),
        mkdir(paths.executive, { recursive: true })
    ]);
    
    return paths;
}

