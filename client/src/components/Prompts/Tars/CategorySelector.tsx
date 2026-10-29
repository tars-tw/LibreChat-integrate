import { useMemo, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Plus, Tag, Pencil, Trash2 } from 'lucide-react';
import {
  Input,
  Button,
  Dropdown,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  useToastContext,
  usePopoverZIndex,
} from '@librechat/client';
import { useRenameTarsPromptCategoryMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const ITEM_CLASSES =
  'text-text-primary hover:bg-surface-hover focus:bg-surface-hover flex cursor-pointer items-center gap-2 rounded-lg text-sm outline-hidden';

type CategoryAction = { kind: 'rename' | 'delete'; category: string } | null;

/**
 * Category picker for pwc_tars prompts. `categories` are the ones already used
 * within the form's scope (personal / this brain / this knowledge base);
 * "add category" appends a local option that is persisted only once a prompt
 * is saved with it — pwc_tars stores categories on the prompt, not in a
 * category table. For the same reason renaming or deleting a category moves
 * every prompt of the scope that uses it (`categoryCounts`) to the new name or
 * to another category; an unused one is only a local option and just goes.
 */
export default function CategorySelector({
  value,
  onChange,
  categories,
  categoryCounts,
  domainId,
  knowledgeBaseId,
  className = '',
}: {
  value: string;
  onChange: (category: string) => void;
  categories: string[];
  categoryCounts: Record<string, number>;
  domainId?: string;
  knowledgeBaseId?: string;
  className?: string;
}) {
  const localize = useLocalize();
  const zIndex = usePopoverZIndex();
  const { showToast } = useToastContext();
  const menu = Ariakit.useMenuStore();

  const [addOpen, setAddOpen] = useState(false);
  const [draftCategory, setDraftCategory] = useState('');
  const [addedCategories, setAddedCategories] = useState<string[]>([]);
  const [action, setAction] = useState<CategoryAction>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState('');

  const options = useMemo(() => {
    const unique = new Set([...categories, ...addedCategories]);
    if (value) {
      unique.add(value);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [categories, addedCategories, value]);

  const renameCategory = useRenameTarsPromptCategoryMutation({
    onSuccess: ({ updated_count }) =>
      showToast({
        status: 'success',
        message: localize('com_ui_tars_prompt_category_updated', { 0: updated_count }),
      }),
    onError: () =>
      showToast({ status: 'error', message: localize('com_ui_tars_prompt_category_update_error') }),
  });

  const usageOf = (category: string) => categoryCounts[category] ?? 0;

  /** Points the form and the local options at `to`, once `from` is gone. */
  const replaceLocally = (from: string, to: string) => {
    setAddedCategories((prev) => {
      const rest = prev.filter((category) => category !== from);
      return to && !rest.includes(to) ? [...rest, to] : rest;
    });
    if (value === from) {
      onChange(to);
    }
  };

  /** Unused categories exist only in this form; used ones are moved in pwc_tars. */
  const moveCategory = (from: string, to: string) => {
    if (usageOf(from) === 0) {
      replaceLocally(from, to);
      setAction(null);
      return;
    }
    renameCategory.mutate(
      {
        old_category: from,
        new_category: to,
        domain_id: domainId,
        knowledge_base_id: knowledgeBaseId,
      },
      {
        onSuccess: () => {
          replaceLocally(from, to);
          setAction(null);
        },
      },
    );
  };

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
    setAddOpen(false);
  };

  const openRename = (category: string) => {
    setRenameDraft(category);
    setAction({ kind: 'rename', category });
  };

  const openDelete = (category: string) => {
    if (usageOf(category) === 0) {
      replaceLocally(category, '');
      return;
    }
    setDeleteTarget('');
    setAction({ kind: 'delete', category });
  };

  const handleRename = () => {
    if (action?.kind !== 'rename') {
      return;
    }
    const next = renameDraft.trim();
    if (!next) {
      showToast({ status: 'error', message: localize('com_ui_prompt_category_required') });
      return;
    }
    if (next === action.category) {
      setAction(null);
      return;
    }
    moveCategory(action.category, next);
  };

  const deleteTargets = useMemo(
    () =>
      action?.kind === 'delete' ? options.filter((category) => category !== action.category) : [],
    [action, options],
  );

  const renameMerges =
    action?.kind === 'rename' &&
    renameDraft.trim() !== action.category &&
    options.includes(renameDraft.trim());

  return (
    <>
      <Ariakit.MenuProvider store={menu}>
        <Ariakit.MenuButton
          className={cn(
            'border-border-medium text-text-primary hover:bg-surface-hover relative inline-flex h-9 items-center justify-between gap-2 rounded-xl border bg-transparent px-3 text-sm transition-all duration-200 ease-in-out sm:w-fit',
            className,
          )}
          aria-label={localize('com_ui_prompt_category_selector_aria')}
        >
          <div className="flex items-center space-x-2">
            <Tag className="icon-sm" aria-hidden="true" />
            <span>{value || localize('com_ui_category')}</span>
          </div>
          <Ariakit.MenuButtonArrow />
        </Ariakit.MenuButton>
        <Ariakit.Menu
          id="tars-category-selector-menu"
          portal={true}
          gutter={8}
          unmountOnHide={true}
          style={{ zIndex }}
          className="popover-ui pointer-events-auto mt-2 max-h-80 min-w-56 overflow-y-auto"
        >
          {options.map((category) => (
            <div key={category} className="flex items-center gap-0.5">
              <Ariakit.MenuItem
                className={cn(ITEM_CLASSES, 'min-w-0 flex-1 px-3 py-3.5 md:px-2.5 md:py-2')}
                onClick={() => onChange(category)}
              >
                <Tag className="icon-sm shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{category}</span>
                {usageOf(category) > 0 && (
                  <span className="text-text-tertiary ms-auto ps-2 text-xs">
                    {usageOf(category)}
                  </span>
                )}
              </Ariakit.MenuItem>
              <Ariakit.MenuItem
                className={cn(ITEM_CLASSES, 'text-text-secondary shrink-0 p-2')}
                aria-label={localize('com_ui_tars_prompt_category_rename_aria', { 0: category })}
                onClick={() => openRename(category)}
              >
                <Pencil className="icon-sm" aria-hidden="true" />
              </Ariakit.MenuItem>
              <Ariakit.MenuItem
                className={cn(ITEM_CLASSES, 'text-text-secondary shrink-0 p-2')}
                aria-label={localize('com_ui_tars_prompt_category_delete_aria', { 0: category })}
                onClick={() => openDelete(category)}
              >
                <Trash2 className="icon-sm" aria-hidden="true" />
              </Ariakit.MenuItem>
            </div>
          ))}
          <Ariakit.MenuItem
            className={cn(ITEM_CLASSES, 'px-3 py-3.5 md:px-2.5 md:py-2')}
            onClick={() => setAddOpen(true)}
          >
            <Plus className="icon-sm" aria-hidden="true" />
            {localize('com_ui_prompt_category_new')}
          </Ariakit.MenuItem>
        </Ariakit.Menu>
      </Ariakit.MenuProvider>

      <OGDialog open={addOpen} onOpenChange={setAddOpen}>
        <OGDialogContent className="w-11/12 max-w-md">
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
              <Button variant="outline" onClick={() => setAddOpen(false)}>
                {localize('com_ui_cancel')}
              </Button>
              <Button variant="submit" onClick={handleAddCategory}>
                {localize('com_ui_add')}
              </Button>
            </div>
          </div>
        </OGDialogContent>
      </OGDialog>

      <OGDialog
        open={action?.kind === 'rename'}
        onOpenChange={(open) => !open && !renameCategory.isLoading && setAction(null)}
      >
        <OGDialogContent className="w-11/12 max-w-md">
          <OGDialogTitle>{localize('com_ui_tars_prompt_category_rename')}</OGDialogTitle>
          <div className="flex flex-col gap-4">
            <Input
              type="text"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              placeholder={localize('com_ui_prompt_category_name')}
              aria-label={localize('com_ui_prompt_category_name')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleRename();
                }
              }}
            />
            {action?.kind === 'rename' && usageOf(action.category) > 0 && (
              <p className="text-text-secondary text-sm">
                {localize(
                  renameMerges
                    ? 'com_ui_tars_prompt_category_merge_desc'
                    : 'com_ui_tars_prompt_category_rename_desc',
                  { 0: renameDraft.trim(), 1: usageOf(action.category) },
                )}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAction(null)}>
                {localize('com_ui_cancel')}
              </Button>
              <Button variant="submit" onClick={handleRename} disabled={renameCategory.isLoading}>
                {localize('com_ui_save')}
              </Button>
            </div>
          </div>
        </OGDialogContent>
      </OGDialog>

      <OGDialog
        open={action?.kind === 'delete'}
        onOpenChange={(open) => !open && !renameCategory.isLoading && setAction(null)}
      >
        <OGDialogContent className="w-11/12 max-w-md">
          <OGDialogTitle>{localize('com_ui_tars_prompt_category_delete')}</OGDialogTitle>
          {action?.kind === 'delete' && (
            <div className="flex flex-col gap-4">
              <p className="text-text-secondary text-sm">
                {localize('com_ui_tars_prompt_category_delete_desc', {
                  0: action.category,
                  1: usageOf(action.category),
                })}
              </p>
              {deleteTargets.length > 0 ? (
                <Dropdown
                  value={deleteTarget}
                  onChange={setDeleteTarget}
                  options={deleteTargets}
                  variant="field"
                  portal={true}
                  label={localize('com_ui_tars_prompt_category_delete_target')}
                  ariaLabel={localize('com_ui_tars_prompt_category_delete_target')}
                />
              ) : (
                <p className="text-text-secondary text-sm">
                  {localize('com_ui_tars_prompt_category_delete_no_target')}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAction(null)}>
                  {localize('com_ui_cancel')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => moveCategory(action.category, deleteTarget)}
                  disabled={!deleteTarget || renameCategory.isLoading}
                >
                  {localize('com_ui_delete')}
                </Button>
              </div>
            </div>
          )}
        </OGDialogContent>
      </OGDialog>
    </>
  );
}
