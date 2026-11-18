import { useEffect, useState } from 'react';
import { OpenIDIcon, useToastContext } from '@librechat/client';
import { useOutletContext, useSearchParams, useLocation } from 'react-router-dom';
import { ErrorTypes, registerPage, TARS_LOGIN_INVALID_PASSWORD } from 'librechat-data-provider';
import type { TTarsLoginAttempt } from 'librechat-data-provider';
import type { TLoginLayoutContext } from '~/common';
import type { TranslationKeys } from '~/hooks';
import { getLoginError, persistRedirectToSession } from '~/utils';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import SocialButton from '~/components/Auth/SocialButton';
import { useAuthContext } from '~/hooks/AuthContext';
import TarsLicenseUpload from './TarsLicenseUpload';
import { useLocalize } from '~/hooks';
import LoginForm from './LoginForm';

interface LoginLocationState {
  redirect_to?: string;
}

/** Error codes the server appends to the login redirect when an OAuth navigation is rejected. */
const oauthErrorKeys: Record<string, TranslationKeys> = {
  [ErrorTypes.AUTH_FAILED]: 'com_auth_error_oauth_failed',
  [ErrorTypes.AUTH_RATE_LIMITED]: 'com_auth_error_login_rl',
  [ErrorTypes.AUTH_BANNED]: 'com_auth_error_login_ban',
};

/** pwc_tars's lockout state on a refused local sign-in, shown in place of the generic message. */
const tarsLoginAttemptText = (
  attempt: TTarsLoginAttempt,
  localize: ReturnType<typeof useLocalize>,
): string => {
  if (attempt.code === TARS_LOGIN_INVALID_PASSWORD) {
    return localize('com_auth_tars_password_remaining', { count: attempt.remainingAttempts ?? 0 });
  }
  if (attempt.retryAfterSeconds == null) {
    return localize('com_auth_tars_account_locked_later');
  }
  return localize('com_auth_tars_account_locked', {
    minutes: Math.max(1, Math.ceil(attempt.retryAfterSeconds / 60)),
  });
};

function Login() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { error, setError, login, tarsLicenseStatus, setTarsLicenseStatus, tarsLoginAttempt } =
    useAuthContext();
  const { startupConfig } = useOutletContext<TLoginLayoutContext>();

  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const disableAutoRedirect = searchParams.get('redirect') === 'false';

  const [isAutoRedirectDisabled, setIsAutoRedirectDisabled] = useState(disableAutoRedirect);

  useEffect(() => {
    const redirectTo = searchParams.get('redirect_to');
    if (redirectTo) {
      persistRedirectToSession(redirectTo);
    } else {
      const state = location.state as LoginLocationState | null;
      if (state?.redirect_to) {
        persistRedirectToSession(state.redirect_to);
      }
    }

    const oauthError = searchParams?.get('error');
    /** `hasOwn` keeps an attacker-supplied `?error=toString` off the prototype chain. */
    const oauthErrorKey =
      oauthError != null && Object.hasOwn(oauthErrorKeys, oauthError)
        ? oauthErrorKeys[oauthError]
        : undefined;
    if (oauthErrorKey != null) {
      showToast({
        message: localize(oauthErrorKey),
        status: 'error',
      });
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('error');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams, showToast, localize, location.state]);

  useEffect(() => {
    if (disableAutoRedirect) {
      setIsAutoRedirectDisabled(true);
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('redirect');
      setSearchParams(newParams, { replace: true });
    }
  }, [disableAutoRedirect, searchParams, setSearchParams]);

  const shouldAutoRedirect =
    startupConfig?.openidLoginEnabled &&
    startupConfig?.openidAutoRedirect &&
    startupConfig?.serverDomain &&
    !isAutoRedirectDisabled;

  useEffect(() => {
    if (shouldAutoRedirect) {
      console.log('Auto-redirecting to OpenID provider...');
      window.location.href = `${startupConfig.serverDomain}/oauth/openid`;
    }
  }, [shouldAutoRedirect, startupConfig]);

  if (shouldAutoRedirect) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <p className="text-lg font-semibold">
          {localize('com_ui_redirecting_to_provider', { 0: startupConfig.openidLabel })}
        </p>
        <div className="mt-4">
          <SocialButton
            key="openid"
            enabled={startupConfig.openidLoginEnabled}
            serverDomain={startupConfig.serverDomain}
            oauthPath="openid"
            Icon={() =>
              startupConfig.openidImageUrl ? (
                <img src={startupConfig.openidImageUrl} alt="OpenID Logo" className="h-5 w-5" />
              ) : (
                <OpenIDIcon />
              )
            }
            label={startupConfig.openidLabel}
            id="openid"
          />
        </div>
      </div>
    );
  }

  return (
    <>
      {error != null && tarsLicenseStatus == null && (
        <ErrorMessage>
          {tarsLoginAttempt != null
            ? tarsLoginAttemptText(tarsLoginAttempt, localize)
            : localize(getLoginError(error))}
        </ErrorMessage>
      )}
      {startupConfig?.emailLoginEnabled === true &&
        (startupConfig.tarsAuth === true ? (
          <TarsLicenseUpload
            forcedLicenseStatus={tarsLicenseStatus}
            onUploaded={() => setTarsLicenseStatus(undefined)}
          >
            <LoginForm
              onSubmit={login}
              startupConfig={startupConfig}
              error={error}
              setError={setError}
            />
          </TarsLicenseUpload>
        ) : (
          <LoginForm
            onSubmit={login}
            startupConfig={startupConfig}
            error={error}
            setError={setError}
          />
        ))}
      {startupConfig?.tarsAuth !== true && startupConfig?.registrationEnabled === true && (
        <p className="text-text-secondary my-4 text-center text-sm font-light">
          {' '}
          {localize('com_auth_no_account')}{' '}
          <a
            href={registerPage()}
            className="text-accent-primary hover:text-accent-primary-hover hover:decoration-accent-primary-hover focus:text-accent-primary-hover focus:decoration-accent-primary-hover inline-flex p-1 text-sm font-medium underline decoration-transparent transition-all duration-200"
          >
            {localize('com_auth_sign_up')}
          </a>
        </p>
      )}
    </>
  );
}

export default Login;
