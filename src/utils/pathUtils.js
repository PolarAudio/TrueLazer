export function getRelativePath(filePath) {
    if (!filePath) return '';
    return filePath.split(/[\\/]/).pop();
}

export default getRelativePath;