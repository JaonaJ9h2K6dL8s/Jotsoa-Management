'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { validatePassword } from '@/lib/validation';
import { apiPost } from '@/services/api-client';

/**
 * Formulaire de changement de mot de passe (initial ou volontaire).
 * Le nouveau mot de passe est validé côté client puis revérifié côté serveur.
 */
export default function ChangePasswordForm({ username }: { username: string }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    try {
      await apiPost('/api/auth/change-password', {
        currentPassword,
        newPassword,
      });
      router.replace('/');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Erreur lors du changement de mot de passe.',
      );
      setLoading(false);
    }
  }

  return (
    <Stack spacing={3} component="form" onSubmit={handleSubmit} noValidate>
      {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
      <TextField
        label="Identifiant"
        value={username}
        fullWidth
        slotProps={{ input: { readOnly: true } }}
        helperText="Compte connecté"
      />
      <TextField
        label="Mot de passe actuel"
        type="password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        autoComplete="current-password"
        required
        fullWidth
        disabled={loading}
      />
      <TextField
        label="Nouveau mot de passe"
        type="password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        autoComplete="new-password"
        required
        fullWidth
        disabled={loading}
        helperText="8 caractères minimum, avec au moins une lettre et un chiffre."
      />
      <TextField
        label="Confirmer le nouveau mot de passe"
        type="password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        autoComplete="new-password"
        required
        fullWidth
        disabled={loading}
      />
      <Button
        type="submit"
        variant="contained"
        size="large"
        disabled={loading}
        startIcon={
          loading ? <CircularProgress size={20} color="inherit" /> : null
        }
      >
        {loading ? 'Enregistrement…' : 'Enregistrer le nouveau mot de passe'}
      </Button>
    </Stack>
  );
}
