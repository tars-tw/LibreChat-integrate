import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { User, Mail, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  Button,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TError, TTarsRegister } from 'librechat-data-provider';
import { useTarsRegisterMutation } from '~/data-provider';
import { ErrorMessage } from './ErrorMessage';
import { useLocalize } from '~/hooks';

const iconBoxClassName =
  'flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-gray-500';
const inputClassName =
  'w-full rounded-r-md border border-gray-300 bg-white px-3.5 py-2.5 text-gray-900 placeholder-gray-400 focus:border-[#fd5108] focus:outline-none';

/**
 * pwc_tars Terms of Service — fixed company legal text, kept identical to the pwc_tars
 * signup page (hardcoded Traditional Chinese there). Intentionally not localized: legal
 * terms must stay constant and must not be machine-translated by the i18n pipeline.
 */
/* eslint-disable i18next/no-literal-string */
const TermsOfServiceContent = () => (
  <div className="max-h-[60vh] overflow-y-auto px-1 text-left text-sm text-gray-800">
    <p className="mb-3 text-center text-lg font-bold">歡迎使用我們的企業內部專用AI平台：TARS</p>
    <p className="mb-2">
      請仔細閱讀並確認您同意以下服務條款，這些條款適用於您在本平台的所有操作和互動。
    </p>
    <h5 className="mb-1 mt-3 font-semibold">1. 使用範圍</h5>
    <p className="mb-2">
      本平台僅供企業內部使用，所有帳戶和資料必須由公司授權的員工使用。任何未經授權的使用都會受到限制或終止。
    </p>
    <h5 className="mb-1 mt-3 font-semibold">2. 帳戶安全</h5>
    <p className="mb-2">
      您應對您的帳戶信息保密，並對通過您的帳戶發生的所有行為負責。若發現任何未經授權的使用或安全漏洞，請立即聯繫我們的客服團隊。
    </p>
    <h5 className="mb-1 mt-3 font-semibold">3. 數據隱私與保護</h5>
    <p className="mb-2">
      本平台將根據公司政策和相關法律法規，保護您的個人數據及機密資訊。您同意我們收集、儲存並處理與您帳戶相關的資料，以提供更好的服務。
    </p>
    <h5 className="mb-1 mt-3 font-semibold">4. 使用限制</h5>
    <p className="mb-1">您不得使用本平台進行以下行為：</p>
    <ul className="mb-2 list-disc pl-6">
      <li>未經授權的數據收集或挖掘。</li>
      <li>任何會對平台安全性、穩定性或性能造成損害的行為。</li>
      <li>傳播病毒或其他有害的程式。</li>
      <li>違反公司政策或法律法規的行為。</li>
    </ul>
    <h5 className="mb-1 mt-3 font-semibold">5. 服務變更或中止</h5>
    <p className="mb-2">
      我們保留隨時修改、更新或終止本平台服務的權利。若平台服務有所變動，我們會提前通知使用者。
    </p>
    <h5 className="mb-1 mt-3 font-semibold">6. 免責聲明</h5>
    <p className="mb-2">
      本平台將盡力確保服務的可用性和穩定性，但對於由於技術問題、外部原因或不可預見的情況所造成的服務中斷或數據丟失，概不負責。
    </p>
    <h5 className="mb-1 mt-3 font-semibold">7. 知識產權</h5>
    <p className="mb-2">
      本平台的所有內容、資料、軟體及技術屬於公司或其授權方，未經授權，您不得以任何方式複製、分發或修改。
    </p>
    <h5 className="mb-1 mt-3 font-semibold">8. 遵守法律</h5>
    <p className="mb-2">
      使用本平台時，您同意遵守所在國家/地區的所有相關法律法規，並不會利用平台進行任何非法行為。
    </p>
    <h5 className="mb-1 mt-3 font-semibold">9. 變更與終止</h5>
    <p className="mb-2">
      本條款可隨時進行修改，並會在平台上發布更新版本。修改後的條款將自發布日起生效。若您不同意修改後的條款，您可選擇終止使用平台。
    </p>
    <h5 className="mb-1 mt-3 font-semibold">10. 聯繫方式</h5>
    <p className="mb-2">
      如對服務條款有任何疑問或建議，請與我們的客戶支持團隊聯繫：
      <br />
      電子郵件：support@pwc.com
    </p>
  </div>
);
/* eslint-enable i18next/no-literal-string */

function TarsRegister() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TTarsRegister>({ mode: 'onChange' });

  const [errorMessage, setErrorMessage] = useState<string>('');
  const [termsOpen, setTermsOpen] = useState<boolean>(false);
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);

  const registerMutation = useTarsRegisterMutation({
    onSuccess: () => {
      showToast({ message: localize('com_auth_tars_register_success'), status: 'success' });
      navigate('/login', { replace: true });
    },
    onError: (err: unknown) => {
      setErrorMessage(
        (err as TError)?.response?.data?.message ?? localize('com_auth_tars_register_failed'),
      );
    },
  });

  const onSubmit = (data: TTarsRegister) => {
    if (!termsAccepted) {
      showToast({ message: localize('com_auth_tars_agree_terms_required'), status: 'error' });
      return;
    }
    setErrorMessage('');
    registerMutation.mutate(data);
  };

  const handleCheckboxClick = () => {
    if (!termsAccepted) {
      setTermsOpen(true);
    } else {
      setTermsAccepted(false);
    }
  };

  const renderError = (field: keyof TTarsRegister) =>
    errors[field] ? (
      <span role="alert" className="mt-1 block text-left text-sm text-red-600">
        {String(errors[field]?.message)}
      </span>
    ) : null;

  return (
    <>
      {errorMessage && <ErrorMessage>{errorMessage}</ErrorMessage>}
      <form className="mt-6" aria-label="Registration form" onSubmit={handleSubmit(onSubmit)}>
        <div className="mb-3">
          <div className="flex">
            <span className={iconBoxClassName}>
              <User className="h-5 w-5" />
            </span>
            <input
              type="text"
              autoComplete="username"
              placeholder={localize('com_auth_username').replace(/[ （(].*$/, '')}
              {...register('username', {
                required: localize('com_auth_tars_username_length'),
                minLength: { value: 4, message: localize('com_auth_tars_username_length') },
                maxLength: { value: 20, message: localize('com_auth_tars_username_length') },
              })}
              aria-invalid={!!errors.username}
              className={inputClassName}
            />
          </div>
          {renderError('username')}
        </div>
        <div className="mb-3">
          <div className="flex">
            <span className={iconBoxClassName}>
              <Mail className="h-5 w-5" />
            </span>
            <input
              type="email"
              autoComplete="email"
              placeholder={localize('com_auth_email_address')}
              {...register('email', {
                required: localize('com_auth_email_required'),
                maxLength: { value: 128, message: localize('com_auth_email_max_length') },
                pattern: { value: /\S+@\S+\.\S+/, message: localize('com_auth_email_pattern') },
              })}
              aria-invalid={!!errors.email}
              className={inputClassName}
            />
          </div>
          {renderError('email')}
        </div>
        <div className="mb-4">
          <div className="flex">
            <span className={iconBoxClassName}>
              <Lock className="h-5 w-5" />
            </span>
            <input
              type="password"
              autoComplete="new-password"
              placeholder={localize('com_auth_password')}
              {...register('password', {
                required: localize('com_auth_tars_password_length'),
                minLength: { value: 8, message: localize('com_auth_tars_password_length') },
                maxLength: { value: 64, message: localize('com_auth_tars_password_length') },
              })}
              aria-invalid={!!errors.password}
              className={inputClassName}
            />
          </div>
          {renderError('password')}
        </div>

        <div className="mb-4 mt-2 flex items-center">
          <input
            type="checkbox"
            id="terms"
            checked={termsAccepted}
            onChange={handleCheckboxClick}
            className="h-4 w-4 rounded border-gray-300 text-[#fd5108] focus:ring-[#fd5108]"
          />
          <label htmlFor="terms" className="ml-2 text-sm text-gray-600">
            {localize('com_auth_tars_agree_prefix')}{' '}
            <button
              type="button"
              onClick={() => setTermsOpen(true)}
              className="font-medium text-[#fd5108] hover:underline"
            >
              {localize('com_auth_tars_terms')}
            </button>
          </label>
        </div>

        <Button
          type="submit"
          aria-label={localize('com_auth_sign_up')}
          disabled={registerMutation.isLoading}
          variant="submit"
          className="h-11 w-full rounded-md text-white hover:brightness-95"
          style={{ backgroundColor: '#fd5108' }}
        >
          {registerMutation.isLoading ? <Spinner /> : localize('com_auth_sign_up')}
        </Button>
      </form>

      <OGDialog open={termsOpen} onOpenChange={setTermsOpen}>
        <OGDialogContent
          title={localize('com_auth_tars_terms')}
          className="w-11/12 max-w-2xl bg-white text-gray-900 shadow-2xl"
        >
          <OGDialogHeader>
            <OGDialogTitle>{localize('com_auth_tars_terms')}</OGDialogTitle>
          </OGDialogHeader>
          <TermsOfServiceContent />
          <div className="flex justify-end gap-2 px-1 pb-1 pt-2">
            <button
              type="button"
              onClick={() => setTermsOpen(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {localize('com_ui_cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                setTermsAccepted(true);
                setTermsOpen(false);
              }}
              className="rounded-md px-4 py-2 text-sm text-white hover:brightness-95"
              style={{ backgroundColor: '#fd5108' }}
            >
              {localize('com_ui_confirm')}
            </button>
          </div>
        </OGDialogContent>
      </OGDialog>
    </>
  );
}

export default TarsRegister;
