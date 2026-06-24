import { SystemRoles } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

/** Whether the authenticated user is a pwc_tars administrator. */
export default function useIsTarsAdmin(): boolean {
  const { user } = useAuthContext();
  return user?.role === SystemRoles.ADMIN && user?.provider === 'tars';
}
