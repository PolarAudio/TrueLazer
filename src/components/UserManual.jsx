import React, { useMemo } from 'react';
import { useTranslation } from '../i18n';
import manualMarkdown from '../../docs/USER_MANUAL.md?raw';

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text) {
    const nodes = [];
    let lastIndex = 0;
    let key = 0;

    for (const match of text.matchAll(INLINE_PATTERN)) {
        if (match.index > lastIndex) {
            nodes.push(text.slice(lastIndex, match.index));
        }

        const token = match[0];
        if (token.startsWith('**')) {
            nodes.push(<strong key={`b-${key++}`}>{token.slice(2, -2)}</strong>);
        } else if (token.startsWith('`')) {
            nodes.push(<code key={`c-${key++}`}>{token.slice(1, -1)}</code>);
        } else if (token.startsWith('[')) {
            const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
            nodes.push(
                <a key={`a-${key++}`} href={link[2]} target="_blank" rel="noopener noreferrer">
                    {link[1]}
                </a>
            );
        } else {
            nodes.push(<em key={`i-${key++}`}>{token.slice(1, -1)}</em>);
        }

        lastIndex = match.index + token.length;
    }

    if (lastIndex < text.length) {
        nodes.push(text.slice(lastIndex));
    }

    return nodes;
}

function splitTableRow(line) {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
}

function isTableSeparator(line) {
    return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function startsBlock(line) {
    return (
        /^#{1,6}\s/.test(line) ||
        /^```/.test(line) ||
        /^(-{3,}|\*{3,})\s*$/.test(line) ||
        /^\s*[-*]\s+/.test(line) ||
        /^\s*\d+\.\s+/.test(line) ||
        /^\|/.test(line)
    );
}

function parseBlocks(markdown) {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let index = 0;
    let key = 0;

    while (index < lines.length) {
        const line = lines[index];

        if (!line.trim()) {
            index += 1;
            continue;
        }

        if (/^```/.test(line)) {
            const code = [];
            index += 1;
            while (index < lines.length && !/^```/.test(lines[index])) {
                code.push(lines[index]);
                index += 1;
            }
            index += 1;
            blocks.push(<pre key={`pre-${key++}`}><code>{code.join('\n')}</code></pre>);
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const level = heading[1].length;
            const Tag = `h${level}`;
            blocks.push(<Tag key={`h-${key++}`}>{renderInline(heading[2])}</Tag>);
            index += 1;
            continue;
        }

        if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
            blocks.push(<hr key={`hr-${key++}`} />);
            index += 1;
            continue;
        }

        if (/^\|/.test(line) && isTableSeparator(lines[index + 1] || '')) {
            const header = splitTableRow(line);
            index += 2;
            const rows = [];
            while (index < lines.length && /^\|/.test(lines[index])) {
                rows.push(splitTableRow(lines[index]));
                index += 1;
            }
            blocks.push(
                <div key={`table-${key++}`} className="user-manual-table-wrap">
                    <table>
                        <thead>
                            <tr>{header.map((cell, i) => <th key={i}>{renderInline(cell)}</th>)}</tr>
                        </thead>
                        <tbody>
                            {rows.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                    {row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell)}</td>)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
            continue;
        }

        if (/^\s*[-*]\s+/.test(line)) {
            const items = [];
            while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
                items.push(lines[index].replace(/^\s*[-*]\s+/, ''));
                index += 1;
            }
            blocks.push(
                <ul key={`ul-${key++}`}>
                    {items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
                </ul>
            );
            continue;
        }

        if (/^\s*\d+\.\s+/.test(line)) {
            const items = [];
            while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
                items.push(lines[index].replace(/^\s*\d+\.\s+/, ''));
                index += 1;
            }
            blocks.push(
                <ol key={`ol-${key++}`}>
                    {items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
                </ol>
            );
            continue;
        }

        const paragraph = [line.trim()];
        index += 1;
        while (
            index < lines.length &&
            lines[index].trim() &&
            !startsBlock(lines[index]) &&
            isTableSeparator(lines[index]) === false
        ) {
            paragraph.push(lines[index].trim());
            index += 1;
        }
        blocks.push(<p key={`p-${key++}`}>{renderInline(paragraph.join(' '))}</p>);
    }

    return blocks;
}

const UserManual = ({ show, onClose }) => {
    const { t } = useTranslation();
    const content = useMemo(() => parseBlocks(manualMarkdown), []);

    if (!show) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content user-manual-window">
                <div className="modal-header">
                    <h3 style={{ margin: 0, fontSize: '15px' }}>{t('userManual.title')}</h3>
                    <button className="close-btn" onClick={onClose} aria-label={t('userManual.closeAria')}>×</button>
                </div>
                <div className="modal-body user-manual-body">
                    <article className="user-manual">{content}</article>
                </div>
            </div>
            <style>{`
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 10000;
                }
                .modal-content {
                    background: #222;
                    color: white;
                    border-radius: 8px;
                    border: 1px solid #444;
                    padding: 0;
                    overflow: hidden;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                }
                .modal-header {
                    background: #333;
                    padding: 10px 15px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .modal-body {
                    padding: 20px;
                }
                .close-btn {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                }
                .close-btn:hover {
                    color: white;
                }
                .user-manual-window {
                    width: min(860px, 92vw);
                    max-height: 88vh;
                    display: flex;
                    flex-direction: column;
                }
                .user-manual-body {
                    overflow-y: auto;
                    max-height: calc(88vh - 45px);
                }
                .user-manual {
                    font-size: 13px;
                    line-height: 1.6;
                    color: #d7d9dc;
                }
                .user-manual h1 {
                    margin: 0 0 14px;
                    font-size: 22px;
                    color: var(--theme-color, #ff8c00);
                }
                .user-manual h2 {
                    margin: 26px 0 10px;
                    padding-bottom: 6px;
                    font-size: 17px;
                    color: var(--theme-color, #ff8c00);
                    border-bottom: 1px solid #3a3a3a;
                }
                .user-manual h3 {
                    margin: 20px 0 8px;
                    font-size: 14px;
                    color: #f0f0f0;
                }
                .user-manual p {
                    margin: 0 0 10px;
                }
                .user-manual ul,
                .user-manual ol {
                    margin: 0 0 12px;
                    padding-left: 22px;
                }
                .user-manual li {
                    margin-bottom: 4px;
                }
                .user-manual code {
                    background: #111;
                    border: 1px solid #3a3a3a;
                    border-radius: 3px;
                    padding: 1px 4px;
                    font-size: 11px;
                }
                .user-manual pre {
                    background: #111;
                    border: 1px solid #3a3a3a;
                    border-radius: 4px;
                    padding: 10px;
                    overflow-x: auto;
                }
                .user-manual pre code {
                    border: none;
                    padding: 0;
                    background: none;
                }
                .user-manual a {
                    color: #8ab4f8;
                }
                .user-manual hr {
                    border: none;
                    border-top: 1px solid #3a3a3a;
                    margin: 20px 0;
                }
                .user-manual-table-wrap {
                    overflow-x: auto;
                    margin: 0 0 14px;
                }
                .user-manual table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }
                .user-manual th,
                .user-manual td {
                    border: 1px solid #3a3a3a;
                    padding: 6px 8px;
                    text-align: left;
                    vertical-align: top;
                }
                .user-manual th {
                    background: #2c2c2c;
                    color: #fff;
                }
            `}</style>
        </div>
    );
};

export default UserManual;
