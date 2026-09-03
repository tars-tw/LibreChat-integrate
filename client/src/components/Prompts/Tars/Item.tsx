import { memo, useId, useMemo, useRef, useState, useCallback } from 'react';
import * as Ariakit from '@ariakit/react';
import { Ellipsis, SquarePen, Trash } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Label,
  Button,
  Spinner,
  OGDialog,
  DropdownPopup,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsPrompt, TPromptGroup, TTarsPromptScope } from 'librechat-data-provider';
import { useDeleteTarsPromptMutation } from '~/data-provider';
import { useLocalize, useSubmitMessage } from '~/hooks';
import VariableDialog from '../dialogs/VariableDialog';
import CategoryIcon from '../utils/CategoryIcon';
import { detectVariables, cn } from '~/utils';

const PROMPT_PATH = '/prompts';

/**
 * `VariableForm` is shaped around a LibreChat prompt group; a pwc_tars prompt has
 * no group, so it is adapted here. The absent `_id` is deliberate — it keeps the
 * form from recording usage against a non-existent LibreChat group.
 */
const asPromptGroup = (prompt: TTarsPrompt): TPromptGroup =>
  ({
    name: prompt.name,
    category: prompt.category ?? '',
    productionPrompt: { prompt: prompt.content },
  }) as TPromptGroup;

function TarsPromptItem({
  prompt,
  isChatRoute = true,
}: {
  prompt: TTarsPrompt;
  isChatRoute?: boolean;
}) {
  const scope: TTarsPromptScope = prompt.scope ?? 'personal';
  const isManageable = scope === 'personal';
  const menuId = useId();
  const params = useParams();
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const { submitPrompt } = useSubmitMessage();

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isVariableDialogOpen, setVariableDialogOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  const promptId = String(prompt.id);
  const isActive = !isChatRoute && params.promptId === promptId;

  const deletePrompt = useDeleteTarsPromptMutation({
    onSuccess: () => {
      setDeleteOpen(false);
      if (isActive) {
        navigate(`${PROMPT_PATH}/new`, { replace: true });
      }
    },
    onError: () => showToast({ status: 'error', message: localize('com_ui_prompt_delete_error') }),
  });

  const onCardClick = useCallback(() => {
    if (!isChatRoute) {
      navigate(`${PROMPT_PATH}/${promptId}`, { replace: true });
      return;
    }
    if (!prompt.content.trim()) {
      return;
    }
    if (detectVariables(prompt.content)) {
      setVariableDialogOpen(true);
      return;
    }
    submitPrompt(prompt.content);
  }, [isChatRoute, navigate, promptId, prompt.content, submitPrompt]);

  const dropdownItems = useMemo(
    () => [
      {
        label: localize('com_ui_edit'),
        onClick: () => navigate(`${PROMPT_PATH}/${promptId}`),
        icon: <SquarePen className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      },
      {
        label: localize('com_ui_delete'),
        onClick: () => setDeleteOpen(true),
        icon: <Trash className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      },
    ],
    [localize, navigate, promptId],
  );

  const snippet = prompt.description?.trim() ? prompt.description : prompt.content;
  const ariaLabel = prompt.category
    ? localize('com_ui_prompt_group_button', { name: prompt.name, category: prompt.category })
    : localize('com_ui_prompt_group_button_no_category', { name: prompt.name });

  return (
    <>
      <div
        className={cn(
          'group/prompt relative mb-1.5 rounded-xl border border-border-light bg-transparent transition-colors hover:bg-surface-secondary',
          isActive && 'bg-surface-hover',
        )}
      >
        <button
          type="button"
          className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
          onClick={onCardClick}
          aria-label={ariaLabel}
        />
        <div className="flex items-start gap-2.5 px-3 py-2.5">
          <CategoryIcon
            category={prompt.category ?? ''}
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <span
              className="block truncate text-sm font-semibold text-text-primary"
              title={prompt.name}
            >
              {prompt.name}
            </span>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-secondary">
              {snippet}
            </p>
          </div>
          {isManageable && (
            <div className="relative z-10 shrink-0">
              <DropdownPopup
                portal={true}
                menuId={menuId}
                focusLoop={true}
                className="z-[125]"
                unmountOnHide={true}
                isOpen={menuOpen}
                setIsOpen={setMenuOpen}
                items={dropdownItems}
                trigger={
                  <Ariakit.MenuButton
                    ref={menuButtonRef}
                    aria-label={localize('com_nav_convo_menu_options')}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-md text-text-secondary transition-opacity hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary',
                      menuOpen
                        ? 'opacity-100'
                        : 'opacity-0 focus-visible:opacity-100 group-hover/prompt:opacity-100',
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Ellipsis className="size-4" aria-hidden="true" />
                  </Ariakit.MenuButton>
                }
              />
            </div>
          )}
        </div>
      </div>
      {isChatRoute && (
        <VariableDialog
          open={isVariableDialogOpen}
          onClose={() => setVariableDialogOpen(false)}
          group={asPromptGroup(prompt)}
        />
      )}
      {isManageable && (
        <OGDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <OGDialogTemplate
            title={localize('com_ui_delete_prompt')}
            className="w-11/12 max-w-md"
            main={<Label>{localize('com_ui_prompt_delete_confirm', { 0: prompt.name })}</Label>}
            selection={
              <Button
                variant="destructive"
                disabled={deletePrompt.isLoading}
                onClick={() => deletePrompt.mutate({ id: promptId })}
              >
                {deletePrompt.isLoading ? <Spinner /> : localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      )}
    </>
  );
}

export default memo(TarsPromptItem);
