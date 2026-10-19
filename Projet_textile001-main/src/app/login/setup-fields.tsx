'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiPost } from '@/services/api-client';
import type { ManagedUser } from '@/types/auth';

/**
 * Champs de création initiale du compte administrateur, affichés dans
 * le panneau droit de la page de connexion. Un seul compte admin peut
 * exister : le serveur refuse toute création supplémentaire (409) et
 * le bouton est désactivé dès qu'un admin est signalé par le serveur.
 */

const EMERALD = '#1fae74';
const GOLD = '#d8c49a';
const MUTED = '#96a29a';

const inputSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '10px',
    backgroundColor: 'rgba(255,255,255,0.045)',
    fontSize: 15,
    '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
    '&:hover fieldset': { borderColor: 'rgba(216,196,154,0.45)' },
    '&.Mui-focused fieldset': {
      borderColor: EMERALD,
      boxShadow: '0 0 0 3px rgba(31,174,116,0.18)',
    },
  },
  '& .MuiInputBase-input': { color: '#eef0ea' },
  '& .MuiInputLabel-root': { color: MUTED },
  '& .MuiInputLabel-root.Mui-focused': { color: GOLD },
  '& .MuiFormHelperText-root': { color: 'rgba(150,162,154,0.75)' },
} as const;

interface SetupFieldsProps {
  adminExists: boolean;
}

export default function SetupFields({ adminExists }: SetupFieldsProps) {
  const router = useRouter();
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = loading || adminExists;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!nom.trim() || !username.trim() || !password) {
      setError('Veuillez renseigner le nom, l’identifiant et le mot de passe.');
      return;
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    try {
      const result = await apiPost<{ status: string; user: ManagedUser }>(
        '/api/auth/setup-admin',
        {
          nom: nom.trim(),
          prenom: prenom.trim() || null,
          username: username.trim(),
          password,
        },
      );
      if (result.status !== 'ok') {
        setError('Échec de la création du compte.');
        setLoading(false);
        return;
      }
      router.replace('/login');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Échec de la création du compte administrateur.',
      );
      setLoading(false);
    }
  }

  return (
    <Stack spacing={2.5} component="form" onSubmit={handleSubmit} noValidate>
      {adminExists ? (
        <Alert
          severity="info"
          sx={{
            borderRadius: '10px',
            backgroundColor: 'rgba(216,196,154,0.10)',
            color: '#e6d9bc',
            '& .MuiAlert-icon': { color: GOLD },
          }}
        >
          Un compte administrateur existe déjà : un seul compte admin peut
          être créé dans l’application.
        </Alert>
      ) : null}
      {error ? (
        <Alert
          severity="error"
          role="alert"
          sx={{
            borderRadius: '10px',
            backgroundColor: 'rgba(255,92,92,0.12)',
            color: '#ffb4b4',
            '& .MuiAlert-icon': { color: '#ff8a8a' },
          }}
        >
          {error}
        </Alert>
      ) : null}
      <TextField
        label="Nom"
        value={nom}
        onChange={(event) => setNom(event.target.value)}
        autoComplete="family-name"
        required
        fullWidth
        disabled={disabled}
        sx={inputSx}
      />
      <TextField
        label="Prénom (facultatif)"
        value={prenom}
        onChange={(event) => setPrenom(event.target.value)}
        autoComplete="given-name"
        fullWidth
        disabled={disabled}
        sx={inputSx}
      />
      <TextField
        label="Identifiant"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        autoComplete="username"
        required
        fullWidth
        disabled={disabled}
        helperText="3 à 40 caractères : lettres, chiffres, . _ -"
        sx={inputSx}
      />
      <TextField
        label="Mot de passe"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        required
        fullWidth
        disabled={disabled}
        helperText="Au moins 8 caractères, avec lettres et chiffres."
        sx={inputSx}
      />
      <TextField
        label="Confirmer le mot de passe"
        type="password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        autoComplete="new-password"
        required
        fullWidth
        disabled={disabled}
        sx={inputSx}
      />
      <Button
        type="submit"
        disabled={disabled}
        startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
        className="jm-sheen"
        sx={{
          mt: 1,
          borderRadius: '10px',
          height: 54,
          backgroundColor: EMERALD,
          backgroundImage: 'none',
          color: '#07130d',
          fontWeight: 700,
          fontSize: 15,
          letterSpacing: '0.04em',
          '&:hover': { backgroundColor: '#25c283', backgroundImage: 'none' },
          '&.Mui-disabled': { backgroundColor: 'rgba(31,174,116,0.35)' },
        }}
        variant="contained"
      >
        {loading ? 'Création…' : 'Créer le compte administrateur'}
      </Button>
    </Stack>
  );
}
