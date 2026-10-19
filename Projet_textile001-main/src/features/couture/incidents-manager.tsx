'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { IncidentDTO } from '@/types/couture';
import { INCIDENT_TYPE_LABELS, INCIDENT_TYPE_OPTIONS, SEVERITY_LABELS } from '@/types/couture';
import { sendCouture, useCoutureData } from './use-couture';

/**
 * Déclaration et traitement des interruptions et anomalies. Une
 * anomalie critique bloque automatiquement l'affectation concernée.
 */

const STATUS_COLORS: Record<string, 'warning' | 'info' | 'success' | 'default'> = {
  ouverte: 'warning',
  en_cours: 'info',
  resolue: 'success',
  cloturee: 'default',
};

export default function IncidentsManager() {
  const { data, loading, error, refresh } = useCoutureData<IncidentDTO[]>(
    '/api/couture/incidents',
  );
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('mineure');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    setFormError(null);
    try {
      await sendCouture('/api/couture/incidents', 'POST', {
        incidentType: type,
        severity,
        description,
      });
      setType('');
      setSeverity('mineure');
      setDescription('');
      setMessage('Incident déclaré.');
      void refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };

  const act = async (incident: IncidentDTO, action: string) => {
    try {
      await sendCouture(`/api/couture/incidents/${incident.id}`, 'PATCH', {
        action,
        note: resolutions[incident.id] ?? undefined,
      });
      setMessage(`Incident #${incident.id} mis à jour.`);
      void refresh();
    } catch (cause) {
      setMessage(null);
      setFormError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {formError ? <Alert severity="error">{formError}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Paper variant="outlined" className="p-3">
        <Typography variant="subtitle1" gutterBottom>
          Déclarer un incident
        </Typography>
        <Stack spacing={2}>
          <TextField
            select
            label="Type d'incident"
            value={type}
            onChange={(event) => setType(event.target.value)}
            size="small"
          >
            {INCIDENT_TYPE_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>
                {INCIDENT_TYPE_LABELS[option]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Gravité"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            size="small"
          >
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Description obligatoire"
            multiline
            minRows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Button
            variant="contained"
            onClick={submit}
            disabled={!type || !description.trim()}
          >
            Déclarer
          </Button>
        </Stack>
      </Paper>

      {(data ?? []).length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun incident enregistré.
        </Typography>
      ) : (
        (data ?? []).map((incident) => (
          <Paper key={incident.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">#{incident.id}</Typography>
                <Chip size="small" label={INCIDENT_TYPE_LABELS[incident.incidentType] ?? incident.incidentType} />
                <Chip
                  size="small"
                  color={incident.severity === 'critique' ? 'error' : 'default'}
                  label={SEVERITY_LABELS[incident.severity]}
                />
                <Chip size="small" color={STATUS_COLORS[incident.status]} label={incident.status} />
              </Stack>
              <Typography variant="body2">{incident.description}</Typography>
              <Typography variant="caption" color="text.secondary">
                {incident.assignmentCode ? `Affectation ${incident.assignmentCode} — ` : ''}
                {incident.roomNom ? `${incident.roomNom} / ${incident.lineNom ?? ''}` : ''}
                {` — déclaré par ${incident.declaredByName ?? '—'} le ${incident.startedAt}`}
              </Typography>
              {['ouverte', 'en_cours'].includes(incident.status) ? (
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                  {incident.status === 'ouverte' ? (
                    <Button size="small" onClick={() => act(incident, 'start')}>
                      Prendre en charge
                    </Button>
                  ) : null}
                  <TextField
                    label="Commentaire de résolution"
                    size="small"
                    value={resolutions[incident.id] ?? ''}
                    onChange={(event) =>
                      setResolutions((prev) => ({ ...prev, [incident.id]: event.target.value }))
                    }
                  />
                  <Button size="small" color="success" onClick={() => act(incident, 'resolve')}>
                    Résoudre
                  </Button>
                </Stack>
              ) : null}
              {incident.status === 'resolue' ? (
                <Button size="small" onClick={() => act(incident, 'close')}>
                  Clôturer
                </Button>
              ) : null}
              {incident.resolutionNote ? (
                <Typography variant="caption" color="text.secondary">
                  Résolution : {incident.resolutionNote}
                </Typography>
              ) : null}
            </Stack>
          </Paper>
        ))
      )}
    </Stack>
  );
}
