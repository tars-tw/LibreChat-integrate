import React, { useState, useEffect, useContext } from 'react';
import { useForm } from 'react-hook-form';
import { User, Lock } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import { ThemeContext, SecretInput, Spinner, Button, isDark } from '@librechat/client';
import type { TLoginUser, TStartupConfig } from 'librechat-data-provider';
import type { TAuthContext } from '~/common';
import { useResendVerificationEmail } from '~/data-provider';
import { validateEmail } from '~/utils';
import { useLocalize } from '~/hooks';

type TLoginFormProps = {
  onSubmit: (data: TLoginUser) => void;
  startupConfig: TStartupConfig;
  error: Pick<TAuthContext, 'error'>['error'];
  setError: Pick<TAuthContext, 'setError'>['setError'];
};

const LoginForm: React.FC<TLoginFormProps> = ({ onSubmit, startupConfig, error, setError }) => {
  const localize = useLocalize();
  const { theme } = useContext(ThemeContext);
  const {
    register,
    getValues,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TLoginUser>();
  const [showResendLink, setShowResendLink] = useState<boolean>(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const useUsernameLogin = startupConfig?.ldap?.username || startupConfig?.tarsAuth;
  const isTars = startupConfig?.tarsAuth === true;
  const tarsLdapEnabled =
    startupConfig?.tarsSso?.enabled === true && startupConfig?.tarsSso?.type === 'ldap';
  const validTheme = isDark(theme) ? 'dark' : 'light';
  const requireCaptcha = Boolean(startupConfig.turnstile?.siteKey);
  const useSsoChecked = watch('use_sso');
  const tarsButtonLabel = useSsoChecked
    ? `SSO ${localize('com_auth_login')}`
    : localize('com_auth_login');
  const buttonLabel = isTars ? tarsButtonLabel : localize('com_auth_continue');
  const authInputClassName =
    'webkit-dark-styles transition-color peer w-full rounded-2xl border border-border-light bg-surface-primary px-3.5 pb-2.5 pt-3 text-text-primary duration-200 hover:border-border-light focus:border-green-500 focus:outline-none focus-visible:border-green-500';
  const authSecretInputClassName = `${authInputClassName} h-auto pr-12`;
  const authLabelClassName =
    'absolute start-3 top-1.5 z-10 origin-[0] -translate-y-4 scale-75 transform bg-surface-primary px-2 text-sm text-text-secondary-alt duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-1.5 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-green-600 dark:peer-focus:text-green-500 rtl:peer-focus:left-auto rtl:peer-focus:translate-x-1/4';
  const authSecretButtonClassName =
    'size-9 rounded-xl text-text-secondary-alt hover:bg-transparent hover:text-text-primary';
  const tarsIconBoxClassName =
    'flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-gray-500';
  const tarsInputClassName =
    'w-full rounded-r-md border border-gray-300 bg-white px-3.5 py-2.5 text-gray-900 placeholder-gray-400 focus:border-[#fd5108] focus:outline-none focus-visible:border-[#fd5108]';

  useEffect(() => {
    if (error && error.includes('422') && !showResendLink) {
      setShowResendLink(true);
    }
  }, [error, showResendLink]);

  const resendLinkMutation = useResendVerificationEmail({
    onMutate: () => {
      setError(undefined);
      setShowResendLink(false);
    },
  });

  if (!startupConfig) {
    return null;
  }

  const renderError = (fieldName: string) => {
    const errorMessage = errors[fieldName]?.message;
    return errorMessage ? (
      <span role="alert" className="mt-1 text-sm text-red-600 dark:text-red-500">
        {String(errorMessage)}
      </span>
    ) : null;
  };

  const handleResendEmail = () => {
    const email = getValues('email');
    if (!email) {
      return setShowResendLink(false);
    }
    resendLinkMutation.mutate({ email });
  };

  const emailField = register('email', {
    required: localize('com_auth_email_required'),
    maxLength: { value: 120, message: localize('com_auth_email_max_length') },
    validate: useUsernameLogin
      ? undefined
      : (value) => validateEmail(value, localize('com_auth_email_pattern')),
  });
  const passwordField = register('password', {
    required: localize('com_auth_password_required'),
    minLength: {
      value: startupConfig?.minPasswordLength || 8,
      message: localize('com_auth_password_min_length'),
    },
    maxLength: { value: 128, message: localize('com_auth_password_max_length') },
  });
  const usernameLabel = useUsernameLogin
    ? localize('com_auth_username').replace(/[ （(].*$/, '')
    : localize('com_auth_email_address');

  return (
    <>
      {showResendLink && (
        <div className="mt-2 rounded-md border border-green-500 bg-green-500/10 px-3 py-2 text-sm text-gray-600 dark:text-gray-200">
          {localize('com_auth_email_verification_resend_prompt')}
          <button
            type="button"
            className="ml-2 text-blue-600 hover:underline"
            onClick={handleResendEmail}
            disabled={resendLinkMutation.isLoading}
          >
            {localize('com_auth_email_resend_link')}
          </button>
        </div>
      )}
      <form
        className="mt-6"
        aria-label="Login form"
        method="POST"
        onSubmit={handleSubmit((data) => onSubmit(data))}
      >
        {isTars ? (
          <div className="mb-3">
            <div className="flex">
              <span className={tarsIconBoxClassName}>
                <User className="h-5 w-5" />
              </span>
              <input
                type="text"
                id="email"
                autoComplete={useUsernameLogin ? 'username' : 'email'}
                aria-label={localize('com_auth_email')}
                placeholder={usernameLabel}
                {...emailField}
                aria-invalid={!!errors.email}
                className={tarsInputClassName}
              />
            </div>
            {renderError('email')}
          </div>
        ) : (
          <div className="mb-4">
            <div className="relative">
              <input
                type="text"
                id="email"
                autoComplete={useUsernameLogin ? 'username' : 'email'}
                aria-label={localize('com_auth_email')}
                {...emailField}
                aria-invalid={!!errors.email}
                className={authInputClassName}
                placeholder=" "
              />
              <label htmlFor="email" className={authLabelClassName}>
                {usernameLabel}
              </label>
            </div>
            {renderError('email')}
          </div>
        )}
        {isTars ? (
          <div className="mb-3">
            <div className="flex">
              <span className={tarsIconBoxClassName}>
                <Lock className="h-5 w-5" />
              </span>
              <input
                type="password"
                id="password"
                autoComplete="current-password"
                aria-label={localize('com_auth_password')}
                placeholder={localize('com_auth_password')}
                {...passwordField}
                aria-invalid={!!errors.password}
                className={tarsInputClassName}
              />
            </div>
            {renderError('password')}
          </div>
        ) : (
          <div className="mb-2">
            <div className="relative">
              <SecretInput
                id="password"
                autoComplete="current-password"
                aria-label={localize('com_auth_password')}
                {...passwordField}
                aria-invalid={!!errors.password}
                className={authSecretInputClassName}
                placeholder=" "
                label={localize('com_auth_password')}
                labelClassName={authLabelClassName}
                controlsClassName="right-2"
                buttonClassName={authSecretButtonClassName}
              />
            </div>
            {renderError('password')}
          </div>
        )}
        {startupConfig.passwordResetEnabled && (
          <a
            href="/forgot-password"
            className="inline-flex p-1 text-sm font-medium text-green-600 underline decoration-transparent transition-all duration-200 hover:text-green-700 hover:decoration-green-700 focus:text-green-700 focus:decoration-green-700 dark:text-green-500 dark:hover:text-green-400 dark:hover:decoration-green-400 dark:focus:text-green-400 dark:focus:decoration-green-400"
          >
            {localize('com_auth_password_forgot')}
          </a>
        )}

        {tarsLdapEnabled && (
          <div className="mt-2 flex items-center">
            <input
              type="checkbox"
              id="use_sso"
              aria-label={localize('com_auth_use_ldap_sso')}
              {...register('use_sso')}
              className={`h-4 w-4 rounded ${
                isTars
                  ? 'border-gray-300 text-[#fd5108] focus:ring-[#fd5108]'
                  : 'border-border-light text-green-600 focus:ring-green-500'
              }`}
            />
            <label
              htmlFor="use_sso"
              className={`ml-2 text-sm ${isTars ? 'text-gray-600' : 'text-text-secondary-alt'}`}
            >
              {localize('com_auth_use_ldap_sso')}
            </label>
          </div>
        )}

        {requireCaptcha && (
          <div className="my-4 flex justify-center">
            <Turnstile
              siteKey={startupConfig.turnstile!.siteKey}
              options={{
                ...startupConfig.turnstile!.options,
                theme: validTheme,
              }}
              onSuccess={setTurnstileToken}
              onError={() => setTurnstileToken(null)}
              onExpire={() => setTurnstileToken(null)}
            />
          </div>
        )}

        <div className="mt-6">
          <Button
            aria-label={buttonLabel}
            data-testid="login-button"
            type="submit"
            disabled={(requireCaptcha && !turnstileToken) || isSubmitting}
            variant="submit"
            className={`w-full ${isTars ? 'h-11 rounded-md text-white hover:brightness-95' : 'h-12 rounded-2xl'}`}
            style={isTars ? { backgroundColor: '#fd5108' } : undefined}
          >
            {isSubmitting ? <Spinner /> : buttonLabel}
          </Button>
        </div>
      </form>
    </>
  );
};

export default LoginForm;
