/**
 * Translation table.
 *
 * Every user-facing string should be looked up here instead of being written
 * inline. Only English is filled in for now; adding a language means adding a
 * block with the same keys under a new locale id. Missing keys fall back to
 * English (and then to the key itself), so a partial translation is safe.
 */
export const DEFAULT_LOCALE = 'en';

export const LOCALES = [
    { id: 'en', label: 'English' },
];

export const TRANSLATIONS = {
    en: {
        'app.name': 'TrueLazer',
        'page.main': 'Show Control',
        'page.timeline': 'Timeline Editor',
        'page.shapeBuilder': 'Shape Builder',

        'fileBrowser.openFolder': 'Open Folder',
        'fileBrowser.selectedDirectory': 'Selected Directory',
        'fileBrowser.noPreview': 'No Preview',
        'fileBrowser.noFiles': 'No valid ILD files found in selected directory.',

        'settings.language': 'Language',
        'settings.languageHelp': 'Choose the language used by the interface. Missing entries fall back to English.',

        'menu.userManual': 'User Manual',
    },
};
