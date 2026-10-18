import { useEffect, useMemo } from 'react';
import { useKettle } from '../context/KettleContext';
import { usePrivate } from '../context/PrivateContext';
import { personalRenewalReminders } from '../lib/reminders';
import { syncReminders } from '../lib/notifications';

/* Hands this phone's whole reminder plan to the OS whenever it changes:
   the household's reminders plus renewal reminders for your own private
   bills. It sits inside both providers so the private list joins the
   household one only here, on the way to the notification system, and
   never inside the household's state or its Alerts screen.

   Local notifications fire without the app running, so someone who never
   opens KTL still hears a bill is coming — the whole point of chase mode. */
export default function ReminderScheduler() {
  const K = useKettle();
  const M = usePrivate();
  const ready = !K.loading && !!K.you && !M.loading;
  const household = K.plannedNotifications;
  const reminders = K.data.reminders;
  const personal = M.state.personal;

  const plan = useMemo(() => {
    if (!ready) return null;
    const mine = personalRenewalReminders({ bills: personal, reminders });
    return [...household, ...mine].sort((a, b) => a.at - b.at);
  }, [ready, household, personal, reminders]);

  useEffect(() => {
    if (!plan) return;
    syncReminders(plan).catch((err) => console.error('Could not schedule reminders', err));
  }, [plan]);

  return null;
}
