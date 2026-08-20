import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Input, Label, Button, Spinner, Dropdown, useToastContext } from '@librechat/client';
import type { TTarsTicket, TTarsTicketDetail } from 'librechat-data-provider';
import type { Option } from '@librechat/client';
import type { TranslationKeys } from '~/hooks';
import {
  useCreateTarsTicketMutation,
  useUpdateTarsTicketMutation,
  useCreateTarsTicketCommentMutation,
} from '~/data-provider';
import { NO_SELECTION, fromSelection, isClosed, ticketFormValues } from './helpers';
import FilePicker, { ExistingAttachments } from './Files';
import { useLocalize } from '~/hooks';
import Comments from './Comments';

const TEXTAREA_CLASSES =
  'w-full resize-y rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy disabled:opacity-60';

/** A `Dropdown` entry. Aliased so the page's option lists read for themselves. */
export type FieldOption = Option;

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

/** pwc_tars rejects a ticket without these three, so the form checks them first. */
type FormErrors = { title?: boolean; description?: boolean; component_id?: boolean };

export default function TicketForm({
  ticket,
  detail,
  detailLoading,
  options,
  locale,
  onBackToNew,
  onCreated,
}: {
  ticket: TTarsTicket | null;
  detail: TTarsTicketDetail | null;
  detailLoading: boolean;
  options: {
    types: FieldOption[];
    priorities: FieldOption[];
    severities: FieldOption[];
    components: FieldOption[];
  };
  locale: string;
  onBackToNew: () => void;
  onCreated: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const isViewing = ticket != null;
  const [form, setForm] = useState(() => ticketFormValues(null));
  const [errors, setErrors] = useState<FormErrors>({});
  const [files, setFiles] = useState<File[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  /**
   * Refill whenever the selection changes, then again once the detail lands.
   * The body is scrolled back to the top so switching tickets never lands the
   * reader halfway down the previous one's form.
   */
  useEffect(() => {
    setForm(ticketFormValues(detail ?? ticket));
    setErrors({});
    setFiles([]);
    setCommentBody('');
    bodyRef.current?.scrollTo({ top: 0 });
  }, [ticket, detail]);

  const readOnly = isViewing && (detailLoading || detail?.editable !== true);
  /** Replies stay open while the ticket is being worked on; only closing stops them. */
  const canComment =
    isViewing &&
    !detailLoading &&
    detail?.remote_status != null &&
    detail.remote_status !== '' &&
    !isClosed(detail.remote_status);

  const existingAttachments = useMemo(() => {
    const remote = detail?.remote_attachments ?? [];
    return remote.length > 0 ? remote : (detail?.attachments ?? []);
  }, [detail]);

  const onError = (error: unknown) =>
    showToast({
      message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
      status: 'error',
    });

  const createMutation = useCreateTarsTicketMutation({
    onSuccess: ({ ticket: created }) => {
      const warning = created?.attach_warning;
      showToast({
        message:
          warning != null && warning !== ''
            ? localize('com_ui_tars_issues_created_warning', { 0: warning })
            : localize('com_ui_tars_issues_created', { 0: created?.jira_ticket_key ?? '—' }),
        status: warning != null && warning !== '' ? 'warning' : 'success',
      });
      setForm(ticketFormValues(null));
      setFiles([]);
      onCreated();
    },
    onError,
  });

  const updateMutation = useUpdateTarsTicketMutation({
    onSuccess: ({ ticket: updated }) => {
      const warning = updated?.attach_warning;
      showToast({
        message:
          warning != null && warning !== ''
            ? localize('com_ui_tars_issues_updated_warning', { 0: warning })
            : localize('com_ui_tars_issues_updated'),
        status: warning != null && warning !== '' ? 'warning' : 'success',
      });
      setFiles([]);
    },
    onError,
  });

  const commentMutation = useCreateTarsTicketCommentMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_issues_comment_sent'), status: 'success' });
      setCommentBody('');
    },
    onError,
  });

  const submitting =
    createMutation.isLoading || updateMutation.isLoading || commentMutation.isLoading;

  const buildFormData = (): FormData => {
    const data = new FormData();
    data.append('title', form.title.trim());
    data.append('description', form.description.trim());
    data.append('type', fromSelection(form.type));
    data.append('priority', fromSelection(form.priority));
    data.append('severity', fromSelection(form.severity));
    data.append('component_id', fromSelection(form.component_id));
    for (const file of files) {
      data.append('attachments', file);
    }
    return data;
  };

  const validate = (): boolean => {
    const next: FormErrors = {
      title: form.title.trim() === '',
      description: form.description.trim() === '',
      component_id: fromSelection(form.component_id) === '',
    };
    setErrors(next);
    return !next.title && !next.description && !next.component_id;
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    if (!isViewing) {
      if (!validate()) {
        return;
      }
      createMutation.mutate(buildFormData());
      return;
    }

    const reply = commentBody.trim();
    /** Field edits and the reply are independent: a closed ticket takes neither. */
    if (detail?.editable === true) {
      if (!validate()) {
        return;
      }
      updateMutation.mutate({ id: ticket.id, data: buildFormData() });
    }
    if (reply !== '') {
      commentMutation.mutate({ id: ticket.id, body: reply });
    }
  };

  const setField = (key: keyof typeof form) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const dropdownOptions = (items: FieldOption[], placeholderKey: TranslationKeys): Option[] => [
    { value: NO_SELECTION, label: localize(placeholderKey) },
    ...items,
  ];

  const title = (() => {
    if (!isViewing) {
      return localize('com_ui_tars_issues_new');
    }
    const key = detail?.jira_ticket_key ?? ticket.jira_ticket_key;
    return key != null && key !== ''
      ? localize('com_ui_tars_issues_view_with_key', { 0: key })
      : localize('com_ui_tars_issues_view');
  })();

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-border-light">
      <header className="flex items-center justify-between gap-2 border-b border-border-light px-4 py-3">
        <h2 className="text-base font-medium text-text-primary">{title}</h2>
        {isViewing && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBackToNew}
            aria-label={localize('com_ui_tars_issues_new')}
            title={localize('com_ui_tars_issues_new')}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        )}
      </header>

      <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div ref={bodyRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          {isViewing && <StatusBanner detail={detail} loading={detailLoading} />}

          <Field
            label={localize('com_ui_tars_issues_field_title')}
            htmlFor="tars-ticket-title"
            required
            error={errors.title === true ? localize('com_ui_tars_issues_required_title') : null}
          >
            <Input
              id="tars-ticket-title"
              value={form.title}
              onChange={(event) => setField('title')(event.target.value)}
              placeholder={localize('com_ui_tars_issues_ph_title')}
              disabled={readOnly}
              aria-invalid={errors.title === true}
            />
          </Field>

          <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
            <Field label={localize('com_ui_tars_issues_field_type')} labelId="tars-ticket-type">
              <Dropdown
                value={form.type}
                onChange={setField('type')}
                options={dropdownOptions(options.types, 'com_ui_tars_issues_ph_type')}
                disabled={readOnly}
                searchable={options.types.length > 8}
                aria-labelledby="tars-ticket-type"
                sizeClasses="w-full"
                className="w-full"
              />
            </Field>
            <Field
              label={localize('com_ui_tars_issues_field_priority')}
              labelId="tars-ticket-priority"
            >
              <Dropdown
                value={form.priority}
                onChange={setField('priority')}
                options={dropdownOptions(options.priorities, 'com_ui_tars_issues_ph_priority')}
                disabled={readOnly}
                searchable={options.priorities.length > 8}
                aria-labelledby="tars-ticket-priority"
                sizeClasses="w-full"
                className="w-full"
              />
            </Field>
            <Field
              label={localize('com_ui_tars_issues_field_severity')}
              labelId="tars-ticket-severity"
            >
              <Dropdown
                value={form.severity}
                onChange={setField('severity')}
                options={dropdownOptions(options.severities, 'com_ui_tars_issues_ph_severity')}
                disabled={readOnly}
                searchable={options.severities.length > 8}
                aria-labelledby="tars-ticket-severity"
                sizeClasses="w-full"
                className="w-full"
              />
            </Field>
            <Field
              label={localize('com_ui_tars_issues_field_component')}
              labelId="tars-ticket-component"
              required
              error={
                errors.component_id === true
                  ? localize('com_ui_tars_issues_required_component')
                  : null
              }
            >
              <Dropdown
                value={form.component_id}
                onChange={setField('component_id')}
                options={dropdownOptions(
                  options.components,
                  options.components.length > 0
                    ? 'com_ui_tars_issues_ph_component'
                    : 'com_ui_tars_issues_ph_no_component',
                )}
                disabled={readOnly}
                searchable={options.components.length > 8}
                aria-labelledby="tars-ticket-component"
                sizeClasses="w-full"
                className="w-full"
              />
            </Field>
          </div>

          <div className={isViewing ? 'grid gap-x-5 gap-y-6 sm:grid-cols-2' : ''}>
            <Field
              label={localize('com_ui_tars_issues_field_description')}
              htmlFor="tars-ticket-description"
              required
              error={
                errors.description === true
                  ? localize('com_ui_tars_issues_required_description')
                  : null
              }
            >
              <textarea
                id="tars-ticket-description"
                rows={isViewing ? undefined : 6}
                value={form.description}
                onChange={(event) => setField('description')(event.target.value)}
                placeholder={localize('com_ui_tars_issues_ph_description')}
                disabled={readOnly}
                aria-invalid={errors.description === true}
                className={`${TEXTAREA_CLASSES} ${isViewing ? 'h-[9.5rem]' : ''}`}
              />
            </Field>
            {isViewing && (
              <Field
                label={`${localize('com_ui_tars_issues_field_comments')}${
                  (detail?.comments?.length ?? 0) > 0 ? ` (${detail?.comments.length})` : ''
                }`}
              >
                <Comments
                  comments={detail?.comments ?? []}
                  error={detail?.comments_error}
                  locale={locale}
                />
              </Field>
            )}
          </div>

          {canComment && (
            <Field
              label={localize('com_ui_tars_issues_field_new_comment')}
              htmlFor="tars-ticket-comment"
            >
              <textarea
                id="tars-ticket-comment"
                rows={3}
                value={commentBody}
                onChange={(event) => setCommentBody(event.target.value)}
                placeholder={localize('com_ui_tars_issues_ph_new_comment')}
                disabled={submitting}
                className={TEXTAREA_CLASSES}
              />
            </Field>
          )}

          <Field label={localize('com_ui_tars_issues_field_attachments')}>
            <div className="space-y-3">
              {isViewing && (
                <ExistingAttachments
                  attachments={existingAttachments}
                  error={detail?.attachments_error}
                />
              )}
              {!readOnly && (
                <FilePicker
                  files={files}
                  onChange={setFiles}
                  disabled={submitting}
                  addLabel={localize(
                    isViewing ? 'com_ui_tars_issues_add_file' : 'com_ui_tars_issues_choose_file',
                  )}
                />
              )}
            </div>
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-border-light px-5 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (isViewing) {
                onBackToNew();
                return;
              }
              setForm(ticketFormValues(null));
              setErrors({});
              setFiles([]);
            }}
            disabled={submitting}
          >
            {localize(isViewing ? 'com_ui_tars_issues_back_to_new' : 'com_ui_clear')}
          </Button>
          {(!isViewing || detail?.editable === true || canComment) && (
            <Button
              type="submit"
              variant="submit"
              disabled={
                submitting || (isViewing && detail?.editable !== true && commentBody.trim() === '')
              }
            >
              {submitting && <Spinner className="mr-2 size-4" />}
              {localize(isViewing ? 'com_ui_save' : 'com_ui_tars_issues_submit')}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

/** One labelled control. Keeps the label/control/error rhythm identical across the form. */
function Field({
  label,
  htmlFor,
  labelId,
  required,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  labelId?: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} id={labelId}>
        {label}
        {required === true && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      {children}
      {error != null && error !== '' && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

/**
 * Why the form is or is not editable. pwc_tars re-checks this server-side, so
 * this only explains the state — it never grants access.
 */
function StatusBanner({ detail, loading }: { detail: TTarsTicketDetail | null; loading: boolean }) {
  const localize = useLocalize();

  if (loading) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-surface-tertiary px-3 py-2 text-xs text-text-secondary">
        <Spinner className="size-3.5" />
        {localize('com_ui_tars_issues_status_loading')}
      </p>
    );
  }

  if (detail?.editable === true) {
    return (
      <p className="rounded-lg bg-blue-100 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
        {localize('com_ui_tars_issues_status_editable', { 0: detail.remote_status ?? '—' })}
      </p>
    );
  }

  const remoteError = detail?.remote_error;
  return (
    <p className="rounded-lg bg-surface-tertiary px-3 py-2 text-xs text-text-secondary">
      {remoteError != null && remoteError !== ''
        ? localize('com_ui_tars_issues_status_error', { 0: remoteError })
        : localize('com_ui_tars_issues_status_readonly', {
            0: detail?.remote_status ?? localize('com_ui_tars_issues_status_unknown'),
          })}
    </p>
  );
}
