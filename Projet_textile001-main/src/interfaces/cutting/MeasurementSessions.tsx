'use client';

import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import Grid from '@mui/material/Grid';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  atelierAction, loadWorkspace, type WorkspaceData,
} from './api';

/**
 * Saisie des relevés de mesure atelier (phase 5.1) — chef de coupe.
 * La pesée primaire porte sur le ROULEAU (entier avant / restant après) ;
 * la consommation réelle = différence des deux pesées, calculée UNE fois
 * à la finalisation, valeur DE SESSION jamais répartie entre plans.
 * Ces relevés n'écrivent jamais dans les rouleaux, les mouvements ni
 * les plans : le stock reste piloté par les transferts.
 */

interface SessionDTO {
  id: number;
  roll_id: number;
  status: 'brouillon' | 'complet' | 'invalide';
  roll_weight_before_kg: number | null;
  roll_weight_after_kg: number | null;
  consumed_kg: number | null;
  measured_gsm: number | null;
  measured_width_cm: number | null;
  instrument: string | null;
  bilan_flag: 'ok' | 'bilan_ecart' | null;
  bilan_comment: string | null;
  invalide_reason: string | null;
  replaces_id: number | null;
  rollCode: string;
  operator: string | null;
}

interface RecordDTO {
  id: number;
  plan_id: number;
  length_used_m: number | null;
  chutes_kg: number | null;
  pieces_kg: number | null;
  planMatelasM: number | null;
  lengthGapM: number | null;
}

interface DetailDTO {
  session: SessionDTO;
  rollCode: string;
  records: RecordDTO[];
  availablePlans: Array<{ id: number; matelas_length_cm: number }>;
  diagnostics: {
    expectedKg: number | null;
    gapKg: number | null;
    toleranceKg: number;
    residueKg: number | null;
  } | null;
  planConsumedKg: number | null;
  tolerance: { uncertaintyKg: number; floorKg: number; toleranceKg: number };
}

const fmt = (value: number | null | undefined, digits = 3): string =>
  value === null || value === undefined ? '—' : value.toFixed(digits);

const STATUS_CHIP: Record<SessionDTO['status'], { color: 'warning' | 'success' | 'default'; label: string }> = {
  brouillon: { color: 'warning', label: 'brouillon' },
  complet: { color: 'success', label: 'complet' },
  invalide: { color: 'default', label: 'invalidé' },
};

export default function MeasurementSessions() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [detail, setDetail] = useState<DetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Création.
  const [rollId, setRollId] = useState('');
  const [beforeKg, setBeforeKg] = useState('');
  const [instrument, setInstrument] = useState('');

  // Édition de la session courante.
  const [editBefore, setEditBefore] = useState('');
  const [editGsm, setEditGsm] = useState('');
  const [editWidth, setEditWidth] = useState('');
  const [editInstrument, setEditInstrument] = useState('');

  // Enregistrement de plan.
  const [planId, setPlanId] = useState('');
  const [lengthM, setLengthM] = useState('');
  const [chutesKg, setChutesKg] = useState('');
  const [piecesKg, setPiecesKg] = useState('');

  // Finalisation / invalidation.
  const [afterKg, setAfterKg] = useState('');
  const [finalGsm, setFinalGsm] = useState('');
  const [finalWidth, setFinalWidth] = useState('');
  const [bilanComment, setBilanComment] = useState('');
  const [invalideReason, setInvalideReason] = useState('');

  const loadSessions = useCallback(async () => {
    const result = await atelierAction<{ sessions: SessionDTO[] }>('measurement.sessions', {});
    setSessions(result.sessions);
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    const item = await atelierAction<DetailDTO>('measurement.session', { sessionId: id });
    setDetail(item);
    setEditBefore(item.session.roll_weight_before_kg === null ? '' : String(item.session.roll_weight_before_kg));
    setEditGsm(item.session.measured_gsm === null ? '' : String(item.session.measured_gsm));
    setEditWidth(item.session.measured_width_cm === null ? '' : String(item.session.measured_width_cm));
    setEditInstrument(item.session.instrument ?? '');
    setAfterKg(item.session.roll_weight_after_kg === null ? '' : String(item.session.roll_weight_after_kg));
    setFinalGsm(item.session.measured_gsm === null ? '' : String(item.session.measured_gsm));
    setFinalWidth(item.session.measured_width_cm === null ? '' : String(item.session.measured_width_cm));
  }, []);

  useEffect(() => {
    Promise.all([loadSessions(), loadWorkspace()])
      .then(([, workspace]) => setData(workspace))
      .catch((err: Error) => setError(err.message));
  }, [loadSessions]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const rolls = data?.rolls ?? [];

  return (
    <Stack spacing={3} sx={{ p: 3 }}>
      <Box>
        <Typography variant="h5" component="h1">Mesures de coupe</Typography>
        <Typography variant="body2" color="text.secondary">
          Pesée du rouleau avant / après déroulage : la consommation réelle est la
          différence des deux pesées, calculée une fois à la finalisation. Ces relevés
          ne modifient jamais le stock ni les mouvements.
        </Typography>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {info && <Alert severity="success" onClose={() => setInfo(null)}>{info}</Alert>}

      {/* ── Nouvelle session ─────────────────────────────────────── */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Nouvelle session de mesure</Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Rouleau</InputLabel>
              <Select value={rollId} label="Rouleau" onChange={(event) => setRollId(event.target.value)}>
                {rolls.map((roll) => (
                  <MenuItem key={roll.id} value={String(roll.id)}>{roll.code}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField fullWidth size="small" type="number" label="Poids rouleau avant (kg) — obligatoire"
              value={beforeKg} onChange={(event) => setBeforeKg(event.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField fullWidth size="small" label="Instrument (balance, précision)"
              value={instrument} onChange={(event) => setInstrument(event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 2 }}>
            <Button variant="contained" fullWidth disabled={busy || !rollId || !beforeKg}
              onClick={() => run(async () => {
                const item = await atelierAction<SessionDTO>('measurement.session-create', {
                  rollId: Number(rollId), rollWeightBeforeKg: beforeKg, instrument,
                });
                setInfo(`Session #${item.id} ouverte en brouillon.`);
                await loadSessions();
                await loadDetail(item.id);
              })}>
              Ouvrir
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* ── Liste ────────────────────────────────────────────────── */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Sessions</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Rouleau</TableCell>
                <TableCell>Statut</TableCell>
                <TableCell align="right">Avant (kg)</TableCell>
                <TableCell align="right">Restant (kg)</TableCell>
                <TableCell align="right">Consommé (kg)</TableCell>
                <TableCell>Bilan</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell>{session.id}</TableCell>
                  <TableCell>{session.rollCode}</TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_CHIP[session.status].color}
                      label={STATUS_CHIP[session.status].label} />
                  </TableCell>
                  <TableCell align="right">{fmt(session.roll_weight_before_kg)}</TableCell>
                  <TableCell align="right">{fmt(session.roll_weight_after_kg)}</TableCell>
                  <TableCell align="right">{fmt(session.consumed_kg)}</TableCell>
                  <TableCell>
                    {session.status === 'invalide'
                      ? session.invalide_reason
                      : session.bilan_flag === 'bilan_ecart'
                        ? <Chip size="small" color="warning" label="écart de bilan" />
                        : session.bilan_flag === 'ok'
                          ? <Chip size="small" color="success" label="bilan ok" />
                          : '—'}
                  </TableCell>
                  <TableCell>
                    <Button size="small" disabled={busy}
                      onClick={() => run(() => loadDetail(session.id))}>
                      Ouvrir
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {sessions.length === 0 && (
                <TableRow><TableCell colSpan={8}>Aucune session de mesure.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* ── Détail ───────────────────────────────────────────────── */}
      {detail && (
        <Paper sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6">
              Session #{detail.session.id} — rouleau {detail.rollCode}
            </Typography>
            <Chip size="small" color={STATUS_CHIP[detail.session.status].color}
              label={STATUS_CHIP[detail.session.status].label} />
            {detail.session.replaces_id !== null && (
              <Chip size="small" label={`corrige la version #${detail.session.replaces_id}`} />
            )}
          </Stack>

          {detail.session.status === 'invalide' && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Session invalidée : {detail.session.invalide_reason}. La donnée est
              préservée mais exclue des indicateurs.
            </Alert>
          )}

          {detail.session.status === 'brouillon' && (
            <>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Pesées et mesures (brouillon, éditable)</Typography>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth size="small" type="number" label="Poids avant (kg)"
                    value={editBefore} onChange={(event) => setEditBefore(event.target.value)} />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth size="small" type="number" label="GSM mesurée (optionnel)"
                    value={editGsm} onChange={(event) => setEditGsm(event.target.value)} />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth size="small" type="number" label="Largeur mesurée cm (optionnel)"
                    value={editWidth} onChange={(event) => setEditWidth(event.target.value)} />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth size="small" label="Instrument"
                    value={editInstrument} onChange={(event) => setEditInstrument(event.target.value)} />
                </Grid>
              </Grid>
              <Button size="small" variant="outlined" disabled={busy} sx={{ mb: 2 }}
                onClick={() => run(async () => {
                  await atelierAction('measurement.session-update', {
                    sessionId: detail.session.id,
                    rollWeightBeforeKg: editBefore,
                    measuredGsm: editGsm === '' ? null : editGsm,
                    measuredWidthCm: editWidth === '' ? null : editWidth,
                    instrument: editInstrument,
                  });
                  setInfo('Session mise à jour.');
                  await loadDetail(detail.session.id);
                })}>
                Enregistrer les mesures
              </Button>
            </>
          )}

          {/* Enregistrements de plans */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Plans de la session</Typography>
          <TableContainer sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Plan</TableCell>
                  <TableCell align="right">Déroulé réel (m)</TableCell>
                  <TableCell align="right">Matelas prévu (m)</TableCell>
                  <TableCell align="right">Écart (m)</TableCell>
                  <TableCell align="right">Chutes (kg)</TableCell>
                  <TableCell align="right">Pièces (kg)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {detail.records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>#{record.plan_id}</TableCell>
                    <TableCell align="right">{fmt(record.length_used_m)}</TableCell>
                    <TableCell align="right">{fmt(record.planMatelasM)}</TableCell>
                    <TableCell align="right">{fmt(record.lengthGapM)}</TableCell>
                    <TableCell align="right">{fmt(record.chutes_kg)}</TableCell>
                    <TableCell align="right">{fmt(record.pieces_kg)}</TableCell>
                  </TableRow>
                ))}
                {detail.records.length === 0 && (
                  <TableRow><TableCell colSpan={6}>Aucun plan rattaché.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {detail.session.status === 'brouillon' && detail.availablePlans.length > 0 && (
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Plan validé du rouleau</InputLabel>
                  <Select value={planId} label="Plan validé du rouleau"
                    onChange={(event) => setPlanId(event.target.value)}>
                    {detail.availablePlans.map((plan) => (
                      <MenuItem key={plan.id} value={String(plan.id)}>
                        #{plan.id} — matelas {plan.matelas_length_cm} cm
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <TextField fullWidth size="small" type="number" label="Déroulé réel (m)"
                  value={lengthM} onChange={(event) => setLengthM(event.target.value)} />
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <TextField fullWidth size="small" type="number" label="Chutes (kg, opt.)"
                  value={chutesKg} onChange={(event) => setChutesKg(event.target.value)} />
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <TextField fullWidth size="small" type="number" label="Pièces (kg, opt.)"
                  value={piecesKg} onChange={(event) => setPiecesKg(event.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, sm: 2 }}>
                <Button variant="outlined" fullWidth disabled={busy || !planId}
                  onClick={() => run(async () => {
                    await atelierAction('measurement.record-save', {
                      sessionId: detail.session.id, planId: Number(planId),
                      lengthUsedM: lengthM === '' ? null : lengthM,
                      chutesKg: chutesKg === '' ? null : chutesKg,
                      piecesKg: piecesKg === '' ? null : piecesKg,
                    });
                    setInfo('Enregistrement de plan sauvegardé.');
                    await loadDetail(detail.session.id);
                  })}>
                  Rattacher
                </Button>
              </Grid>
            </Grid>
          )}

          {/* Finalisation */}
          {detail.session.status === 'brouillon' && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Finalisation (pesée du rouleau restant)</Typography>
              <Grid container spacing={2}>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth size="small" type="number" label="Rouleau restant (kg)"
                    value={afterKg} onChange={(event) => setAfterKg(event.target.value)} />
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <TextField fullWidth size="small" type="number" label="GSM mesurée (opt.)"
                    value={finalGsm} onChange={(event) => setFinalGsm(event.target.value)} />
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <TextField fullWidth size="small" type="number" label="Largeur mesurée (opt.)"
                    value={finalWidth} onChange={(event) => setFinalWidth(event.target.value)} />
                </Grid>
                <Grid size={{ xs: 12, sm: 3 }}>
                  <TextField fullWidth size="small" label="Commentaire (requis si écart de bilan)"
                    value={bilanComment} onChange={(event) => setBilanComment(event.target.value)} />
                </Grid>
                <Grid size={{ xs: 12, sm: 2 }}>
                  <Button variant="contained" fullWidth disabled={busy || !afterKg}
                    onClick={() => run(async () => {
                      const item = await atelierAction<{ session: SessionDTO }>('measurement.session-finalize', {
                        sessionId: detail.session.id,
                        rollWeightAfterKg: afterKg,
                        measuredGsm: finalGsm === '' ? null : finalGsm,
                        measuredWidthCm: finalWidth === '' ? null : finalWidth,
                        bilanComment: bilanComment,
                      });
                      setInfo(`Session finalisée : consommé ${item.session.consumed_kg} kg.`);
                      await Promise.all([loadSessions(), loadDetail(detail.session.id)]);
                    })}>
                    Finaliser
                  </Button>
                </Grid>
              </Grid>
              <TextField fullWidth size="small" sx={{ mt: 2 }} label="Motif d'invalidation"
                value={invalideReason} onChange={(event) => setInvalideReason(event.target.value)}
                InputProps={{ endAdornment: (
                  <Button size="small" color="warning" disabled={busy || !invalideReason}
                    onClick={() => run(async () => {
                      await atelierAction('measurement.session-invalidate', {
                        sessionId: detail.session.id, reason: invalideReason,
                      });
                      setInfo('Session invalidée (donnée préservée).');
                      await Promise.all([loadSessions(), loadDetail(detail.session.id)]);
                    })}>
                    Invalider
                  </Button>
                ) }} />
            </>
          )}

          {detail.session.status === 'complet' && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Indicateurs (session complète, figée)</Typography>
              <Grid container spacing={2}>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Typography variant="caption" color="text.secondary">Consommation réelle (session)</Typography>
                  <Typography>{fmt(detail.session.consumed_kg)} kg</Typography>
                </Grid>
                {detail.planConsumedKg !== null && (
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Typography variant="caption" color="text.secondary">
                      Attribuable au plan (session mono-plan)
                    </Typography>
                    <Typography>{fmt(detail.planConsumedKg)} kg</Typography>
                  </Grid>
                )}
                {detail.diagnostics?.expectedKg !== null && detail.diagnostics?.expectedKg !== undefined && (
                  <>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Typography variant="caption" color="text.secondary">Attendu (longueur × largeur × GSM mesurées)</Typography>
                      <Typography>{fmt(detail.diagnostics.expectedKg)} kg</Typography>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Typography variant="caption" color="text.secondary">
                        Écart (tolérance {fmt(detail.diagnostics.toleranceKg)} kg)
                      </Typography>
                      <Typography color={detail.diagnostics.gapKg !== null
                        && Math.abs(detail.diagnostics.gapKg) > detail.diagnostics.toleranceKg
                        ? 'warning.main' : 'text.primary'}>
                        {fmt(detail.diagnostics.gapKg)} kg
                      </Typography>
                    </Grid>
                  </>
                )}
                {detail.diagnostics?.residueKg !== null && detail.diagnostics?.residueKg !== undefined && (
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <Typography variant="caption" color="text.secondary">Résidu non mesuré</Typography>
                    <Typography>{fmt(detail.diagnostics.residueKg)} kg</Typography>
                  </Grid>
                )}
              </Grid>
              {detail.session.bilan_flag === 'bilan_ecart' && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  Écart de bilan au-delà de la tolérance ({fmt(detail.diagnostics?.toleranceKg)} kg) :
                  {detail.session.bilan_comment ? ` ${detail.session.bilan_comment}` : ' commentaire absent.'}
                  La mesure physique est conservée telle quelle, sans correction automatique.
                </Alert>
              )}
              <Button size="small" variant="outlined" sx={{ mt: 2 }} disabled={busy}
                onClick={() => run(async () => {
                  const item = await atelierAction<SessionDTO>('measurement.session-replace', {
                    sessionId: detail.session.id,
                  });
                  setInfo(`Correction ouverte : session #${item.id} (brouillon), version précédente invalidée.`);
                  await loadSessions();
                  await loadDetail(item.id);
                })}>
                Corriger par nouvelle version
              </Button>
            </>
          )}
        </Paper>
      )}
    </Stack>
  );
}
