import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

//logic.!
/**
 *@description read the file from the path and parse it to json
 */
export async function readJSON(filePath) {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);

}
/**
 * Write the content into the path file.!
 */
export async function writeFile(filePath, content) {
    const dir = path.dirname(filePath);
    //check if the directory exists..!
    if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true })//if the path is not their 
        //we can create the directory..!s
    }
    await fs.writeFile(filePath, content, "utf-8");

}
//the Main Function to ensure the directory exists..!s
export async function ensureDir(dirPath) {
    //the dirpath..!
    if (!existsSync(dirPath)) {
        await fs.mkdir(dirPath, { recursive: true });//if the path is not their 
    }
}

/**
 * it will have one function to read,one function to write and one to enusre the directory exists..!
 */