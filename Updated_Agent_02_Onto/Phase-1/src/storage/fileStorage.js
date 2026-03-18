/**
 * @Module File Storage
 * @Description Save and retrieve metadata from disk (artifacts folder)
 * Simpler alternative to MongoDB for POC/demo
 */

import { writeFile, readFile, mkdir, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import logger from '../utils/logger.js';
import config from '../config/index.js';
import { ensureFolders } from '../utils/folderOrganizer.js';

/**
 * Save processed metadata to disk
 * @param {string} fileId - Unique file identifier
 * @param {Object} data - Metadata to save
 * @returns {Promise<string>} Path to saved file
 */
export async function saveMetadata(fileId, data) {
    try {
        // Create organized folders
        const paths = await ensureFolders(fileId);

        // Save metadata.json in json/ folder
        const metadataPath = join(paths.json, 'metadata.json');
        await writeFile(metadataPath, JSON.stringify(data, null, 2), 'utf-8');

        logger.info({ fileId, path: metadataPath }, 'Metadata saved to disk');

        return metadataPath;
    } catch (error) {
        logger.error({ error: error.message, fileId }, 'Failed to save metadata');
        throw error;
    }
}

/**
 * Get metadata from disk by fileId
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<Object>} Parsed metadata
 */
export async function getMetadata(fileId) {
    try {
        // Try new organized location first
        const newPath = join(config.storage.artifactsDir, fileId, 'json', 'metadata.json');
        // Fallback to old location for backward compatibility
        const oldPath = join(config.storage.artifactsDir, fileId, 'metadata.json');

        const metadataPath = existsSync(newPath) ? newPath : oldPath;

        if (!existsSync(metadataPath)) {
            throw new Error(`Metadata not found for fileId: ${fileId}`);
        }

        const content = await readFile(metadataPath, 'utf-8');
        const metadata = JSON.parse(content);

        logger.info({ fileId }, 'Metadata loaded from disk');

        return metadata;
    } catch (error) {
        logger.error({ error: error.message, fileId }, 'Failed to get metadata');
        throw error;
    }
}

/**
 * Save generated artifact to disk
 * @param {string} fileId - Unique file identifier
 * @param {string} artifactType - Type of artifact (dbml, sql, erd)
 * @param {string} content - Artifact content
 * @param {string} filename - Filename for artifact
 * @returns {Promise<string>} Path to saved artifact
 */
export async function saveArtifact(fileId, artifactType, content, filename) {
    try {
        const artifactDir = join(config.storage.artifactsDir, fileId);
        await mkdir(artifactDir, { recursive: true });

        const artifactPath = join(artifactDir, filename);
        await writeFile(artifactPath, content, 'utf-8');

        logger.info({ fileId, artifactType, path: artifactPath }, 'Artifact saved');

        return artifactPath;
    } catch (error) {
        logger.error({ error: error.message, fileId }, 'Failed to save artifact');
        throw error;
    }
}

/**
 * Get artifact content from disk
 * @param {string} fileId - Unique file identifier
 * @param {string} filename - Artifact filename
 * @returns {Promise<string>} Artifact content
 */
export async function getArtifact(fileId, filename) {
    try {
        const artifactPath = join(config.storage.artifactsDir, fileId, filename);

        if (!existsSync(artifactPath)) {
            throw new Error(`Artifact not found: ${filename} for fileId: ${fileId}`);
        }

        const content = await readFile(artifactPath, 'utf-8');

        logger.info({ fileId, filename }, 'Artifact loaded');

        return content;
    } catch (error) {
        logger.error({ error: error.message, fileId, filename }, 'Failed to get artifact');
        throw error;
    }
}

/**
 * List all uploads
 * @returns {Promise<Array>} List of upload directories
 */
export async function listAllUploads() {
    try {
        const artifactsDir = config.storage.artifactsDir;

        if (!existsSync(artifactsDir)) {
            await mkdir(artifactsDir, { recursive: true });
            return [];
        }

        const dirs = await readdir(artifactsDir, { withFileTypes: true });
        const uploads = dirs
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        logger.info({ count: uploads.length }, 'Listed all uploads');

        return uploads;
    } catch (error) {
        logger.error({ error: error.message }, 'Failed to list uploads');
        throw error;
    }
}

/**
 * Check if metadata exists for fileId
 * @param {string} fileId - Unique file identifier
 * @returns {boolean} True if exists
 */
export function metadataExists(fileId) {
    // Check new organized location first, then fallback to old location
    const newPath = join(config.storage.artifactsDir, fileId, 'json', 'metadata.json');
    const oldPath = join(config.storage.artifactsDir, fileId, 'metadata.json');
    return existsSync(newPath) || existsSync(oldPath);
}

/**
 * Check which artifacts exist for fileId
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<Object>} Object with artifact status
 */
export async function getArtifactStatus(fileId) {
    try {
        const artifactDir = join(config.storage.artifactsDir, fileId);

        if (!existsSync(artifactDir)) {
            return null;
        }

        // Check organized folder structure
        const jsonDir = join(artifactDir, 'json');
        const dbmlDir = join(artifactDir, 'dbml');
        const logicalDir = join(artifactDir, 'logical');
        const physicalDir = join(artifactDir, 'physical');
        const executiveDir = join(artifactDir, 'executive');

        return {
            metadata: existsSync(join(jsonDir, 'metadata.json')),
            dbml: existsSync(join(dbmlDir, 'schema.dbml')),
            erd_png: existsSync(join(logicalDir, 'erd.png')),
            erd_svg: existsSync(join(logicalDir, 'erd.svg')),
            erd_pdf: existsSync(join(logicalDir, 'erd.pdf')),
            mysql_sql: existsSync(join(physicalDir, 'mysql.sql')),
            executive_report: existsSync(join(executiveDir, 'EXECUTIVE_REPORT.html')),
            interactive: existsSync(join(executiveDir, 'erd_INTERACTIVE.html')),
        };
    } catch (error) {
        logger.error({ error: error.message, fileId }, 'Failed to get artifact status');
        throw error;
    }
}

/**
 * Delete all artifacts for fileId
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<void>}
 */
export async function deleteArtifacts(fileId) {
    try {
        const artifactDir = join(config.storage.artifactsDir, fileId);

        if (existsSync(artifactDir)) {
            await rm(artifactDir, { recursive: true, force: true });
            logger.info({ fileId }, 'Artifacts deleted');
        }
    } catch (error) {
        logger.error({ error: error.message, fileId }, 'Failed to delete artifacts');
        throw error;
    }
}

