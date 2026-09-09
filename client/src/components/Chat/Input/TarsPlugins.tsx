import React, { memo } from 'react';
import { Puzzle } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { useBadgeRowContext } from '~/Providers';
import { badgeAccents } from './accents';

/** One composer badge per pwc_tars plugin tool the user pinned or switched on. */
function TarsPlugins() {
  const context = useBadgeRowContext();
  if (!context) {
    return null;
  }
  const { tools, isSelected, isPinned, toggle } = context.tarsPlugins;

  return (
    <>
      {tools
        .filter((tool) => isPinned(tool.name) || isSelected(tool.name))
        .map((tool) => (
          <CheckboxButton
            key={tool.name}
            checked={isSelected(tool.name)}
            setValue={() => toggle(tool.name)}
            label={tool.display_name}
            isCheckedClassName={badgeAccents.purple}
            icon={<Puzzle className="icon-md" aria-hidden="true" />}
          />
        ))}
    </>
  );
}

export default memo(TarsPlugins);
