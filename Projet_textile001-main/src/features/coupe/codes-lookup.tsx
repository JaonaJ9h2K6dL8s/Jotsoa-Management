'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { apiGet, apiPost } from '@/services/api-client';
import type { LookupResultDTO } from '@/types/coupe';

/**
 * Recherche par code manuel ou contenu de QR code, et réimpression
 * d'étiquettes. Le scan ne remplace jamais l'authentification : les
 * permissions sont vérifiées côté serveur à chaque appel.
 */
export default function CodesLookup() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<LookupResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchedType, setSearchedType] = useState<string | null>(null);

  async function handleSearch() {
    setBusy(true);
    setError(null);
    setResult(null);
    setInfo(null);
    try {
      const body = (await apiGet<{ item: LookupResultDTO }>(
        `/api/coupe/codes?code=${encodeURIComponent(code.trim())}`,
      )) as { item: LookupResultDTO };
      setResult(body.item);
      setSearchedType(code.includes('|') ? 'qr' : 'manuel');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReprint() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/coupe/codes', {
        objectType: result.objectType,
        objectId: result.objectId,
      });
      setInfo(
        'Étiquette réimprimée : le code et le QR identifient toujours le même enregistrement.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2} maxWidth={640}>
      {error ? <Alert severity="error" onClose={() => setError(null)}>{error}</Alert> : null}
      {info ? (
        <Alert severity="success" onClose={() => setInfo(null)}>
          {info}
        </Alert>
      ) : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          label="Saisir un code manuel ou un contenu de QR (JO|…)"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="flex-1"
          size="small"
          helperText="La saisie manuelle remplace le scan en cas d'étiquette endommagée."
        />
        <Button variant="contained" onClick={handleSearch} disabled={busy || !code.trim()}>
          Rechercher
        </Button>
      </Stack>

      {result ? (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Box>
                <Typography variant="h6">{result.label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Type : {result.objectType} — Code : {result.code} — Statut actuel :{' '}
                  {result.statusLabel}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Recherche par saisie {searchedType === 'qr' ? 'de QR code' : 'manuelle'} — les
                  deux méthodes retrouvent le même enregistrement.
                </Typography>
              </Box>
              <Box className="flex items-center gap-4">
                <Box
                  component="img"
                  src={`/api/coupe/qr?payload=${encodeURIComponent(
                    `JO|${result.objectType.toUpperCase()}|${result.code}`,
                  )}`}
                  alt={`QR code ${result.code}`}
                  className="h-40 w-40"
                />
                <Stack spacing={1}>
                  <Typography variant="body2">
                    Le QR affiché encode le code stable de l&apos;enregistrement.
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleReprint}
                    disabled={busy}
                  >
                    Réimprimer l&apos;étiquette
                  </Button>
                </Stack>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
}
