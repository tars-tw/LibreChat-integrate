import { useState } from 'react';
import { User, Mail, Lock } from 'lucide-react';
import {
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  useToastContext,
} from '@librechat/client';
import type { TError } from 'librechat-data-provider';
import { useTarsForgotPasswordMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const iconBoxClassName =
  'flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-gray-500';
const inputClassName =
  'w-full rounded-r-md border border-gray-300 bg-white px-3.5 py-2.5 text-gray-900 placeholder-gray-400 focus:border-[#fd5108] focus:outline-none';

const emptyForm = { username: '', user_email: '', new_password: '' };

function TarsForgotPasswordModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const resetMutation = useTarsForgotPasswordMutation({
    onSuccess: () => {
      showToast({ message: localize('com_auth_tars_password_updated'), status: 'success' });
      setForm(emptyForm);
      setError(null);
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      setError(
        (err as TError)?.response?.data?.message ??
          localize('com_auth_tars_password_update_failed'),
      );
    },
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = () => {
    setError(null);
    resetMutation.mutate(form);
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        title={localize('com_auth_tars_forgot_title')}
        className="w-11/12 max-w-md bg-white text-gray-900 shadow-2xl"
      >
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_auth_tars_forgot_title')}</OGDialogTitle>
        </OGDialogHeader>
        <div className="space-y-3 px-1 py-2">
          <div className="flex">
            <span className={iconBoxClassName}>
              <User className="h-5 w-5" />
            </span>
            <input
              name="username"
              type="text"
              value={form.username}
              onChange={handleChange}
              placeholder={localize('com_auth_username').replace(/[ （(].*$/, '')}
              className={inputClassName}
            />
          </div>
          <div className="flex">
            <span className={iconBoxClassName}>
              <Mail className="h-5 w-5" />
            </span>
            <input
              name="user_email"
              type="email"
              value={form.user_email}
              onChange={handleChange}
              placeholder={localize('com_auth_email_address')}
              className={inputClassName}
            />
          </div>
          <div className="flex">
            <span className={iconBoxClassName}>
              <Lock className="h-5 w-5" />
            </span>
            <input
              name="new_password"
              type="password"
              value={form.new_password}
              onChange={handleChange}
              placeholder={localize('com_auth_tars_new_password')}
              className={inputClassName}
            />
          </div>
          {error != null && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-1 pb-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {localize('com_ui_cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={resetMutation.isLoading}
            className="rounded-md px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-60"
            style={{ backgroundColor: '#fd5108' }}
          >
            {localize('com_ui_confirm')}
          </button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}

export default TarsForgotPasswordModal;
