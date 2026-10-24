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
    { id: 'zh', label: '简体中文' },
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
    zh: {
        'app.name': 'TrueLazer',
        'page.main': '演出控制',
        'page.timeline': '时间轴编辑器',
        'page.shapeBuilder': '图形编辑器',

        'fileBrowser.openFolder': '打开文件夹',
        'fileBrowser.selectedDirectory': '已选目录',
        'fileBrowser.noPreview': '无预览',
        'fileBrowser.noFiles': '所选目录中未找到有效的 ILD 文件。',

        'settings.language': '语言',
        'settings.languageHelp': '选择界面语言。缺少的翻译将回退到英语。',

        'menu.userManual': '使用手册',
    },
};
