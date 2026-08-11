import { useMemo, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Plus, Tag } from 'lucide-react';
import {
  Input,
  Button,
  OGDialog,
  OGDialogTitle,
  DropdownPopup,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { MenuItemProps } from '@librechat/client';
import { useLocalize } from '~/hooks';
import useTarsPrompts from './hooks';
import { cn } from '~/utils';

/**
 * Category picker for pwc_tars prompts. Options are the categories already used
 * by the user's prompts; "add category" appends a local option that is persisted
 * only once a prompt is saved with it — pwc_tars stores categories on the prompt.
 */
export default function CategorySelector({
  value,
  onChange,
  className = '',
}: {
  value: string;
  onChange: (category: string) => void;
  className?: string;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { categories } = useTarsPrompts();

  const [isOpen, setIsOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftCategory, setDraftCategory] = useState('');
  const [addedCategories, setAddedCategories] = useState<string[]>([]);

  const options = useMemo(() => {
    const unique = new Set([...categories, ...addedCategories]);
    if (value) {
      unique.add(value);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [categories, addedCategories, value]);

  const handleAddCategory = () => {
    const category = draftCategory.trim();
    if (!category) {
      showToast({ status: 'error', message: localize('com_ui_prompt_category_required') });
      return;
    }
    if (options.some((option) => option.toLowerCase() === category.toLowerCase())) {
      showToast({ status: 'error', message: localize('com_ui_prompt_category_exists') });
      return;
    }
    setAddedCategories((prev) => [...prev, category]);
    onChange(category);
    setDraftCategory('');
    setDialogOpen(false);
  };

  const menuItems: MenuItemProps[] = useMemo(() => {
    const items: MenuItemProps[] = options.map((category) => ({
      id: category,
      label: category,
      icon: <Tag className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      onClick: () => {
        onChange(category);
        setIsOpen(false);
      },
    }));

    items.push({
      id: 'tars-add-category',
      label: localize('com_ui_prompt_category_new'),
      icon: <Plus className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      onClick: () => {
        setIsOpen(false);
        setDialogOpen(true);
      },
    });

    return items;
  }, [options, onChange, localize]);

  return (
    <>
      <DropdownPopup
        portal={true}
        className="mt-2"
        items={menuItems}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        menuId="tars-category-selector-menu"
        trigger={
          <Ariakit.MenuButton
            className={cn(
              'relative inline-flex h-9 items-center justify-between gap-2 rounded-xl border border-border-medium bg-transparent px-3 text-sm text-text-primary transition-all duration-200 ease-in-out hover:bg-surface-hover sm:w-fit',
              className,
            )}
            onClick={() => setIsOpen(!isOpen)}
            aria-label={localize('com_ui_prompt_category_selector_aria')}
          >
            <div className="flex items-center space-x-2">
              <Tag className="icon-sm" aria-hidden="true" />
              <span>{value || localize('com_ui_category')}</span>
            </div>
            <Ariakit.MenuButtonArrow />
          </Ariakit.MenuButton>
        }
      />
      <OGDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <OGDialogContent className="w-11/12 max-w-md bg-surface-primary text-text-primary">
          <OGDialogTitle>{localize('com_ui_prompt_category_new')}</OGDialogTitle>
          <div className="flex flex-col gap-4">
            <Input
              type="text"
              value={draftCategory}
              onChange={(e) => setDraftCategory(e.target.value)}
              placeholder={localize('com_ui_prompt_category_name')}
              aria-label={localize('com_ui_prompt_category_name')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCategory();
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {localize('com_ui_cancel')}
              </Button>
              <Button variant="submit" onClick={handleAddCategory}>
                {localize('com_ui_add')}
              </Button>
            </div>
          </div>
        </OGDialogContent>
      </OGDialog>
    </>
  );
}
