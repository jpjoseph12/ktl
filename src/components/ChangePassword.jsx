import { useState } from 'react';
import Icon from './Icon';
import { useAuth } from '../context/AuthContext';
import { useScreen } from '../context/ScreenContext';
import { MIN_PASSWORD_LENGTH, validPassword } from '../lib/validation';
import { authMessage, PasswordField } from '../screens/android/Onboarding';

/* House → Password. Signing in is email + password now, so changing it
   has to be possible without going through a reset link. */
export default function ChangePassword() {
  const { updatePassword } = useAuth();
  const { toast } = useScreen();
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const ok = validPassword(password);
    setInvalid(!ok);
    if (!ok) return;
    setError('');
    setBusy(true);
    try {
      await updatePassword(password);
      setPassword('');
      toast('Password changed. Use the new one next time you log in.');
    } catch (err) {
      setError(authMessage(err, 'Could not change your password.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <PasswordField
        id="change-password" label="New password" value={password} onChange={setPassword} invalid={invalid}
        autoComplete="new-password" help={`At least ${MIN_PASSWORD_LENGTH} characters. Other devices stay logged in.`}
      />
      {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
      <button type="submit" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} disabled={busy || !password}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
