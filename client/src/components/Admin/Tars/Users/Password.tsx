import { useState } from 'react';
import {
  Input,
  Label,
  Button,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsUser } from 'librechat-data-provider';
import { useResetTarsUserPasswordMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordModal({
  user,
  onOpenChange,
}: {
  user: TTarsUser;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const mutation = useResetTarsUserPasswordMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_users_password_reset'), status: 'success' });
      onOpenChange(false);
    },
    onError: (error) =>
      showToast({
        message:
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          localize('com_ui_tars_admin_error'),
        status: 'error',
      }),
  });

  const handleSave = () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      showToast({ message: localize('com_ui_tars_users_password_min'), status: 'error' });
      return;
    }
    if (password !== confirm) {
      showToast({ message: localize('com_ui_tars_users_password_mismatch'), status: 'error' });
      return;
    }
    mutation.mutate({ id: user.id, password });
  };

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_users_reset_password')}
        showCloseButton={true}
        className="w-11/12 max-w-md"
        main={
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">{user.username}</p>
            <div>
              <Label htmlFor="tars-user-new-password">
                {localize('com_ui_tars_users_new_password')}
              </Label>
              <Input
                id="tars-user-new-password"
                type="password"
                className="mt-1"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="tars-user-confirm-password">
                {localize('com_ui_tars_users_confirm_password')}
              </Label>
              <Input
                id="tars-user-confirm-password"
                type="password"
                className="mt-1"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={handleSave} disabled={mutation.isLoading}>
            {mutation.isLoading ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
