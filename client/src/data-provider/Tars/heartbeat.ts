import { useEffect } from 'react';
import { Time, dataService } from 'librechat-data-provider';

/**
 * Reports every open, signed-in tab to pwc_tars, whose user list shows an account online
 * while its last report is under five minutes old (`ONLINE_THRESHOLD_MINUTES`, fixed
 * pwc_tars-side). Beating every two minutes rides out one lost beat and the up-to-a-minute
 * delay browsers add to background-tab timers.
 */
export const useTarsHeartbeat = (isAuthenticated = false) => {
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const beat = () => {
      dataService.sendTarsHeartbeat().catch(() => undefined);
    };

    beat();
    const interval = setInterval(beat, Time.TWO_MINUTES);
    return () => clearInterval(interval);
  }, [isAuthenticated]);
};
