import React from 'react';
import { useTranslation } from '../i18n';
import { translate } from '../i18n/translate';
import { TRANSLATIONS } from '../i18n/translations';
import Mappable from './Mappable';

const ColumnHeader = ({ name, index, onTrigger, onShowColumnHeaderContextMenu }) => {
  const { t } = useTranslation();
  const displayName = (!name || Object.keys(TRANSLATIONS).some(loc => translate(loc, 'column.defaultName', { index: index + 1 }) === name)) ? t('column.defaultName', { index: index + 1 }) : name;
  const handleContextMenu = (e) => {
    e.preventDefault();
    if (onShowColumnHeaderContextMenu) {
      onShowColumnHeaderContextMenu(index);
    }
  };

  const handleClick = (e) => {
    // Only trigger if it's a left click
    if (e.button === 0 && onTrigger) {
      onTrigger();
    }
  };

  return (
    <Mappable id={`column_${index}`}>
        <div 
        className="column-header trigger-button" 
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{ cursor: 'pointer' }}
        >
        {displayName}
        </div>
    </Mappable>
  );
};

export default ColumnHeader;