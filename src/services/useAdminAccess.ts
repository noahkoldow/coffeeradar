import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getCachedAdminAccess, resolveAdminAccess, subscribeAdminAccess } from './adminAccess';
import { auth } from './firebase';

/** Recheck on navigation focus and foregrounding so one transient failure is not sticky. */
export const useAdminAccess = (userId?: string | null, email?: string | null): boolean => {
  const [allowed, setAllowed] = useState(() => getCachedAdminAccess(email));
  useEffect(() => {
    const update = () => setAllowed(!!userId && auth.currentUser?.uid === userId && getCachedAdminAccess(email));
    update();
    return subscribeAdminAccess(update);
  }, [userId, email]);

  useFocusEffect(useCallback(() => {
    let active = true;
    const refresh = () => {
      if (!userId || auth.currentUser?.uid !== userId) { setAllowed(false); return; }
      void resolveAdminAccess()
        .then(value => { if (active) setAllowed(value); })
        .catch(() => { if (active) setAllowed(getCachedAdminAccess(email)); });
    };
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    const timer = setInterval(refresh, 5 * 60 * 1000);
    return () => { active = false; subscription.remove(); clearInterval(timer); };
  }, [userId, email]));

  return !!userId && auth.currentUser?.uid === userId && allowed && getCachedAdminAccess(email);
};
