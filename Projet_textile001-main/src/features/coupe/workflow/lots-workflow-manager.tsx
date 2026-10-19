'use client';

import { useMemo, useState } from 'react';
import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import LinearProgress from '@mui/material/LinearProgress';
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
import AddIcon from '@mui/icons-material/Add';
import { LOT_STATUS_LABELS, type LotStatus } from '@/types/coupe';
import type { LotWorkflowRow } from '@/server/coupe/lot-workflow';
import { useCoupeData } from '../use-coupe';
import LotCreateDialog from './lot-create-dialog';
import { StatusChip, WORKFLOW_STATUS_ORDER, formatDateTime } from './workflow-common';

/**
 * Tableau de bord central des lots de coupe : recherche, filtres,
 * progression et actions. Les lots nécessitant une intervention
 * (bloqués, à confirmer) apparaissent en priorité.
 */

export default function LotsWorkflowManager() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const url = `/api/coupe/lots/workflow?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`;
  const { data, loading, error, refresh } = useCoupeData<LotWorkflowRow[]>(url);
  const [createOpen, setCreateOpen] = useState(false);

  const lots = useMemo(() => {
    const items = [...(data ?? [])];
    items.sort((a, b) => {
      const rankA = WORKFLOW_STATUS_ORDER.indexOf(a.status);
      const rankB = WORKFLOW_STATUS_ORDER.indexOf(b.status);
      if (rankA !== rankB) return rankA - rankB;
      return b.id - a.id;
    });
    return items;
  }, [data]);

  function progress(lot: LotWorkflowRow): number {
    if (lot.totalPlannedQty <= 0) return 0;
    return Math.min(100, Math.round((lot.totalCutQty / lot.totalPlannedQty) * 100));
  }

  return (
    <Stack spacing={2}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Stack direction="row" spacing={2} alignItems="center">
        <TextField
          size="small"
          label="Recherche (lot, commande, client, produit)"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ minWidth: 320 }}
        />
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Statut</InputLabel>
          <Select
            label="Statut"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <MenuItem value="">Tous</MenuItem>
            {(Object.keys(LOT_STATUS_LABELS) as LotStatus[]).map((key) => (
              <MenuItem key={key} value={key}>
                {LOT_STATUS_LABELS[key]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
        >
          Créer un lot
        </Button>
      </Stack>

      {loading ? <CircularProgress size={24} /> : null}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Numéro</TableCell>
              <TableCell>Commande</TableCell>
              <TableCell>Produit</TableCell>
              <TableCell align="right">Prévu</TableCell>
              <TableCell align="right">Coupé</TableCell>
              <TableCell>Progression</TableCell>
              <TableCell>Responsable</TableCell>
              <TableCell>Créé le</TableCell>
              <TableCell>Statut</TableCell>
              <TableCell>Alertes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lots.map((lot) => (
              <TableRow key={lot.id} hover>
                <TableCell>
                  <Link href={`/coupe/lots/${lot.id}`}>
                    {lot.code}
                  </Link>
                </TableCell>
                <TableCell>
                  {lot.orderCode ?? '—'}
                  {lot.orderType ? (
                    <Typography variant="caption" display="block" color="text.secondary">
                      {lot.orderType === 'externe'
                        ? `Client : ${lot.clientNom ?? '—'}`
                        : 'Interne'}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>
                  {lot.productNom}
                  {lot.colorNom ? (
                    <Typography variant="caption" display="block" color="text.secondary">
                      {lot.colorNom}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell align="right">{lot.totalPlannedQty}</TableCell>
                <TableCell align="right">{lot.totalCutQty}</TableCell>
                <TableCell sx={{ minWidth: 120 }}>
                  <LinearProgress
                    variant="determinate"
                    value={progress(lot)}
                    sx={{ height: 8, borderRadius: 4 }}
                  />
                  <Typography variant="caption">{progress(lot)} %</Typography>
                </TableCell>
                <TableCell>{lot.responsableNom ?? '—'}</TableCell>
                <TableCell>{formatDateTime(lot.createdAt)}</TableCell>
                <TableCell><StatusChip status={lot.status} /></TableCell>
                <TableCell>
                  {lot.status === 'bloque' ? (
                    <Typography variant="caption" color="error">
                      Intervention requise
                    </Typography>
                  ) : lot.status === 'resultat_a_confirmer' ? (
                    <Typography variant="caption" color="warning.dark">
                      À confirmer
                    </Typography>
                  ) : lot.status === 'plan_a_valider' ? (
                    <Typography variant="caption" color="warning.dark">
                      Plan à valider
                    </Typography>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!loading && lots.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10}>
                  <Typography variant="body2" color="text.secondary">
                    Aucun lot. Créez un lot à partir d&apos;une commande prête pour
                    la coupe.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      <LotCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void refresh();
        }}
      />
    </Stack>
  );
}
