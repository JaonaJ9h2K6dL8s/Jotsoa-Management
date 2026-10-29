'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Switch from '@mui/material/Switch';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SaveIcon from '@mui/icons-material/Save';
import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPut } from '@/services/api-client';
import type { RoleCode } from '@/lib/roles';
import {
  ANIMATION_FREQUENCIES,
  ANIMATION_FREQUENCY_LABELS,
  ANIMATION_STYLES,
  ANIMATION_STYLE_LABELS,
  MASCOTS,
  defaultMascotConfig,
  type MascotConfig,
} from '@/lib/mascots/registry';
import MascotArt from './mascot-art';

/**
 * Section « Ma mascotte » des paramètres du compte.
 * Chaque utilisateur modifie uniquement SA configuration : la sauvegarde
 * part vers /api/mascots qui dérive l'identifiant de la session.
 */

export default function MascotSettings({ roleCode }: { roleCode: RoleCode }) {
  const [config, setConfig] = useState<MascotConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewAnimation, setPreviewAnimation] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ status: string; config: MascotConfig }>('/api/mascots')
      .then((data) => {
        if (!cancelled) setConfig(data.config);
      })
      .catch(() => {
        if (!cancelled) setError('Impossible de charger la configuration.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Petite animation de prévisualisation en boucle légère.
  useEffect(() => {
    if (!config) return;
    const timer = setInterval(() => {
      setPreviewAnimation((value) => (value + 1) % 3);
    }, 2200);
    return () => clearInterval(timer);
  }, [config]);

  const defaults = useMemo(
    () => defaultMascotConfig(roleCode),
    [roleCode],
  );

  function patch(partial: Partial<MascotConfig>): void {
    setConfig((current) => (current ? { ...current, ...partial } : current));
  }

  async function handleSave(next?: MascotConfig): Promise<void> {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const data = await apiPut<{ status: string; config: MascotConfig }>(
        '/api/mascots',
        next ?? config,
      );
      setConfig(data.config);
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Erreur lors de la sauvegarde.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(): Promise<void> {
    await handleSave(defaults);
  }

  if (loading || !config) {
    return (
      <Typography color="text.secondary">
        Chargement de la mascotte…
      </Typography>
    );
  }

  const animations = ['Salut', 'Saut', 'Validation'];

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Prévisualisation */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          mb: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          bgcolor: 'background.paper',
        }}
      >
        <Box
          sx={{
            animation:
              previewAnimation === 1
                ? 'mascot-hop 1.1s ease-in-out infinite'
                : previewAnimation === 0
                  ? 'mascot-wave 1.1s ease-in-out 2'
                  : 'mascot-nod 0.9s ease-in-out 2',
            '@keyframes mascot-wave': {
              '0%, 100%': { transform: 'rotate(0deg)' },
              '25%': { transform: 'rotate(-10deg)' },
              '75%': { transform: 'rotate(10deg)' },
            },
            '@keyframes mascot-hop': {
              '0%, 100%': { transform: 'translateY(0)' },
              '50%': { transform: 'translateY(-7px)' },
            },
            '@keyframes mascot-nod': {
              '0%, 100%': { transform: 'scale(1)' },
              '50%': { transform: 'scale(1.08, 0.92)' },
            },
            '@media (prefers-reduced-motion: reduce)': {
              animation: 'none !important',
            },
          }}
        >
          <MascotArt id={config.mascotId} size={84} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>
            {MASCOTS[config.mascotId].label}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {MASCOTS[config.mascotId].welcome}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Aperçu : {animations[previewAnimation]}
          </Typography>
        </Box>
      </Paper>

      {/* Choix de la mascotte */}
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Choisir ma mascotte
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(3, 1fr)',
            sm: 'repeat(4, 1fr)',
            md: 'repeat(7, 1fr)',
          },
          gap: 1.5,
          mb: 3,
        }}
      >
        {Object.values(MASCOTS).map((mascot) => {
          const selected = mascot.id === config.mascotId;
          return (
            <Paper
              key={mascot.id}
              variant="outlined"
              component="button"
              type="button"
              onClick={() => patch({ mascotId: mascot.id })}
              aria-pressed={selected}
              sx={{
                p: 1.5,
                cursor: 'pointer',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0.5,
                bgcolor: 'background.paper',
                borderColor: selected ? 'primary.main' : 'divider',
                borderWidth: selected ? 2 : 1,
                '&:hover': { borderColor: 'primary.light' },
              }}
            >
              <MascotArt id={mascot.id} size={52} />
              <Typography variant="caption" sx={{ color: 'text.primary' }}>
                {mascot.label}
              </Typography>
            </Paper>
          );
        })}
      </Box>

      <Divider sx={{ mb: 3 }} />

      {/* Réglages */}
      <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 560 }}>
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Style d&apos;animation
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={config.animationStyle}
            onChange={(_, value) => value && patch({ animationStyle: value })}
          >
            {ANIMATION_STYLES.map((style) => (
              <ToggleButton key={style} value={style}>
                {ANIMATION_STYLE_LABELS[style]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>

        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Fréquence des animations
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={config.animationFrequency}
            onChange={(_, value) =>
              value && patch({ animationFrequency: value })
            }
          >
            {ANIMATION_FREQUENCIES.map((frequency) => (
              <ToggleButton key={frequency} value={frequency}>
                {ANIMATION_FREQUENCY_LABELS[frequency]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>

        <FormControlLabel
          control={
            <Switch
              checked={config.animationEnabled}
              onChange={(event) =>
                patch({ animationEnabled: event.target.checked })
              }
            />
          }
          label="Activer la mascotte animée"
        />
        <FormControlLabel
          control={
            <Switch
              checked={config.messagesEnabled}
              onChange={(event) =>
                patch({ messagesEnabled: event.target.checked })
              }
            />
          }
          label="Afficher les messages de la mascotte"
        />
      </Box>

      <Box sx={{ display: 'flex', gap: 1.5, mt: 3 }}>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={() => handleSave()}
          disabled={saving}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<RestartAltIcon />}
          onClick={handleRestore}
          disabled={saving}
        >
          Restaurer les valeurs par défaut
        </Button>
      </Box>

      <Snackbar
        open={saved}
        autoHideDuration={3000}
        onClose={() => setSaved(false)}
        message="Préférences de mascotte enregistrées."
      />
    </Box>
  );
}
