'use client';

import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiPost } from '@/services/api-client';
import type { LoginResponse } from '@/types/auth';
import BrandPanel, { BrandMark } from './brand-panel';
import SetupFields from './setup-fields';

/**
 * Connexion JO Management — direction « maison de luxe textile » :
 * panneau éditorial à gauche, formulaire encre et or à droite, avec
 * bascule « Connexion / Créer le compte administrateur ». Un seul compte
 * admin peut être créé : le serveur refuse les suivants (409). Les
 * messages d'erreur sont génériques : ils ne révèlent ni si
 * l'identifiant ni si le mot de passe est incorrect.
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
} as const;

type Mode = 'login' | 'setup';

export default function LoginForm({ adminExists }: { adminExists: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Veuillez renseigner votre identifiant et votre mot de passe.");
      return;
    }
    setLoading(true);
    try {
      const result = await apiPost<LoginResponse>('/api/auth/login', {
        username: username.trim(),
        password,
      });
      if (!('redirectTo' in result) || !result.redirectTo) {
        setError(
          'status' in result && 'message' in result
            ? result.message
            : 'Échec de la connexion.',
        );
        setLoading(false);
        return;
      }
      router.replace(result.redirectTo);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Échec de la connexion. Vérifiez vos identifiants.',
      );
      setLoading(false);
    }
  }

  const loginFields = (
    <>
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
        label="Identifiant"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        autoComplete="username"
        required
        fullWidth
        disabled={loading}
        sx={inputSx}
      />
      <TextField
        label="Mot de passe"
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        required
        fullWidth
        disabled={loading}
        sx={inputSx}
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={
                    showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'
                  }
                  onClick={() => setShowPassword((value) => !value)}
                  edge="end"
                  sx={{ color: MUTED }}
                >
                  {showPassword ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
    </>
  );

  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      sx={{ width: '100%', minHeight: '100dvh' }}
    >
      {/* Panneau éditorial gauche (desktop) */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, width: '54%' }}>
        <BrandPanel />
      </Box>

      {/* Filet doré vertical */}
      <Box
        className="jm-hairline"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: '1px',
          my: 6,
        }}
      />

      {/* Panneau formulaire */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          px: { xs: 3, sm: 6, lg: 8 },
          py: { xs: 5, md: 6 },
        }}
      >
        {/* En-tête mobile */}
        <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 5 }}>
          <Box className="jm-reveal">
            <BrandMark />
          </Box>
        </Box>

        <Box
          sx={{
            width: '100%',
            maxWidth: 420,
            m: 'auto',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
          }}
        >
          {mode === 'login' ? (
            <>
              <Typography
                className="jm-serif jm-reveal"
                sx={{ fontSize: { xs: 36, lg: 44 }, fontWeight: 400, lineHeight: 1.1 }}
              >
                Bon retour.
              </Typography>
              <Typography
                className="jm-reveal"
                sx={{ mt: 1.5, color: MUTED, fontSize: 15, animationDelay: '0.1s' }}
              >
                Accédez à votre espace de pilotage.
              </Typography>
              <Stack
                id="login-form"
                className="jm-reveal"
                spacing={2.5}
                component="form"
                onSubmit={handleSubmit}
                noValidate
                sx={{ mt: 5, animationDelay: '0.2s' }}
              >
                {loginFields}
                <Button
                  type="submit"
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
                  className="jm-sheen"
                  sx={{
                    mt: 1.5,
                    borderRadius: '10px',
                    height: 54,
                    backgroundColor: EMERALD,
                    backgroundImage: 'none',
                    color: '#07130d',
                    fontWeight: 700,
                    fontSize: 15,
                    letterSpacing: '0.04em',
                    '&:hover': {
                      backgroundColor: '#25c283',
                      backgroundImage: 'none',
                    },
                    '&.Mui-disabled': { backgroundColor: 'rgba(31,174,116,0.35)' },
                  }}
                  variant="contained"
                >
                  {loading ? 'Ouverture…' : 'Entrer dans l’atelier'}
                </Button>
              </Stack>
            </>
          ) : (
            <>
              <Typography
                className="jm-serif"
                sx={{ fontSize: { xs: 32, lg: 40 }, fontWeight: 400, lineHeight: 1.1 }}
              >
                Première installation.
              </Typography>
              <Typography sx={{ mt: 1.5, color: MUTED, fontSize: 15 }}>
                Un seul compte administrateur peut être créé.
              </Typography>
              <Box sx={{ mt: 4 }}>
                <SetupFields adminExists={adminExists} />
              </Box>
            </>
          )}
          <Box className="jm-reveal" sx={{ mt: 5, textAlign: 'center', animationDelay: '0.35s' }}>
            <Link
              component="button"
              type="button"
              onClick={() => {
                setMode((current) => (current === 'login' ? 'setup' : 'login'));
                setError(null);
              }}
              sx={{
                color: GOLD,
                fontSize: 13.5,
                letterSpacing: '0.03em',
                textDecorationColor: 'rgba(216,196,154,0.4)',
                '&:hover': { textDecorationColor: GOLD },
              }}
            >
              {mode === 'login'
                ? 'Première installation ? Créer le compte administrateur'
                : 'Retour à la connexion'}
            </Link>
          </Box>
        </Box>

        <Typography
          sx={{
            display: { xs: 'none', md: 'block' },
            textAlign: 'center',
            color: 'rgba(150,162,154,0.6)',
            fontSize: 12,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}
        >
          JO Management — Gestion intégrée de l’entreprise
        </Typography>
      </Box>
    </Stack>
  );
}
