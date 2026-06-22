import React, { useState, useEffect, useContext } from 'react';
import { useForm } from 'react-hook-form';
import { User, Lock } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import {
  ThemeContext,
  SecretInput,
  Spinner,
  Button,
  Input,
  isDark,
  floatingLabel,
} from '@librechat/client';
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
  /** The `webauthn` token lets the browser offer a passkey inline in this field's autofill. */
  const baseAutoComplete = useUsernameLogin ? 'username' : 'email';
  const emailAutoComplete = startupConfig.passkeyLoginEnabled
    ? `${baseAutoComplete} webauthn`
    : baseAutoComplete;
  const useSsoChecked = watch('use_sso');
  const tarsButtonLabel = useSsoChecked
    ? `SSO ${localize('com_auth_login')}`
    : localize('com_auth_login');
  const buttonLabel = isTars ? tarsButtonLabel : localize('com_auth_continue');
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
      <span role="alert" className="text-text-destructive mt-1 text-sm">
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
        <div className="border-status-success-border bg-status-success-subtle text-text-secondary mt-2 rounded-md border px-3 py-2 text-sm">
          {localize('com_auth_email_verification_resend_prompt')}
          <button
            type="button"
            className="text-link ms-2 hover:underline"
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
                autoComplete={emailAutoComplete}
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
              <Input
                colorTransition
                type="text"
                id="email"
                autoComplete={emailAutoComplete}
                aria-label={localize('com_auth_email')}
                {...emailField}
                aria-invalid={!!errors.email}
                variant="floating"
                placeholder=" "
              />
              <label htmlFor="email" className={floatingLabel}>
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
                colorTransition
                id="password"
                autoComplete="current-password"
                aria-label={localize('com_auth_password')}
                {...passwordField}
                aria-invalid={!!errors.password}
                variant="floating"
                placeholder=" "
                label={localize('com_auth_password')}
              />
            </div>
            {renderError('password')}
          </div>
        )}
        {startupConfig.passwordResetEnabled && (
          <a
            href="/forgot-password"
            className="text-accent-primary hover:text-accent-primary-hover hover:decoration-accent-primary-hover focus:text-accent-primary-hover focus:decoration-accent-primary-hover inline-flex p-1 text-sm font-medium underline decoration-transparent transition-all duration-200"
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
            shape={isTars ? undefined : 'soft'}
            size={isTars ? undefined : 'auth'}
            className={`w-full ${isTars ? 'h-11 rounded-md text-white hover:brightness-95' : ''}`}
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
