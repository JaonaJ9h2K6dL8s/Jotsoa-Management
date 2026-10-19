'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/services/api-client';
import type { SettingRow } from '@/types/config';

/**
 * Paramètres généraux de l'entreprise.
 * Les valeurs sont stockées dans SQLite (table app_meta) et chargées
 * dynamiquement. Aucun secret ne transite par cette section.
 */

interface FieldDef {
  key: string;
  label: string;
  helper?: string;
}

const FIELDS: FieldDef[] = [
  { key: 'company_name', label: "Nom de l'entreprise" },
  { key: 'app_name', label: "Nom de l'application", helper: "Valeur initiale : JO Management" },
  { key: 'app_subtitle', label: "Sous-titre de l'application", helper: "Valeur initiale : Gestion intégrée de l'entreprise" },
  { key: 'timezone', label: 'Fuseau horaire', helper: 'Format Zone/Ville, ex. Indian/Antananarivo' },
  { key: 'date_format', label: "Format d'affichage des dates", helper: 'Ex. dd/MM/yyyy' },
  { key: 'default_page_size', label: 'Lignes par page', helper: 'Entier entre 10 et 100' },
];

export default function SettingsForm() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await apiGet<{ items: SettingRow[] }>('/api/config/settings');
        if (!cancelled) {
          setValues(
            Object.fromEntries(result.items.map((item) => [item.key, item.value])),
          );
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Erreur de chargement.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const result = await apiPut<{ items: SettingRow[] }>('/api/config/settings', values);
      setValues(Object.fromEntries(result.items.map((item) => [item.key, item.value])));
      setInfo('Paramètres enregistrés.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Stack className="py-8" alignItems="center">
        <CircularProgress size={28} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2} component={Paper} variant="outlined" className="p-4">
      {error ? <Alert severity="error">{error}</Alert> : null}
      {info ? (
        <Alert severity="success" onClose={() => setInfo(null)}>
          {info}
        </Alert>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        Ces paramètres sont utilisés par les modules de l&apos;application. Les
        secrets et mots de passe ne sont jamais stockés ici.
      </Typography>
      {FIELDS.map((field) => (
        <TextField
          key={field.key}
          label={field.label}
          value={values[field.key] ?? ''}
          onChange={(event) =>
            setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
          }
          helperText={field.helper}
          fullWidth
        />
      ))}
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer les paramètres'}
        </Button>
      </Stack>
    </Stack>
  );
}
