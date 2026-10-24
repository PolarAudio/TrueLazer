import { normalizePage, PAGE_LABELS } from './projectRouting.js';

const DEFAULT_PROJECT_NAMES = {
    main: 'New Show Project',
    timeline: 'New Timeline Project',
    shapeBuilder: 'New Shape Project',
};

/**
 * Turn an absolute project path into the name shown in the window title.
 * Handles both Windows and POSIX separators because project files may come
 * from either platform, and strips only the final extension.
 */
export function projectDisplayName(filePath) {
    if (typeof filePath !== 'string' || filePath.trim() === '') return '';
    const fileName = filePath.split(/[/\\]/).filter(Boolean).pop() || '';
    const dot = fileName.lastIndexOf('.');
    return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/**
 * Build the window title for the page that is currently showing.
 *
 * Each editor owns a separate document in a separate format, so a title that
 * only said "TrueLazer - <file>" made it impossible to tell a show project
 * from a timeline or shape project. Including the page label keeps the three
 * windows distinguishable at a glance.
 */
export function buildWindowTitle({ page, filePath, baseTitle = 'TrueLazer' } = {}) {
    const normalizedPage = normalizePage(page);
    const pageLabel = PAGE_LABELS[normalizedPage] || PAGE_LABELS.main;
    const projectName = projectDisplayName(filePath) || DEFAULT_PROJECT_NAMES[normalizedPage];
    return `${baseTitle} - ${pageLabel} - ${projectName}`;
}

export { DEFAULT_PROJECT_NAMES };
