'use client';

import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { LotWorkflowRow, LotCheckResult, LotAnomalyDTO } from '@/server/coupe/lot-workflow';
import type { OrderRow } from '@/server/orders/orders';
import { ANOMALY_TYPE_LABELS, formatDateTime } from './workflow-common';

/**
 * Panneau d'informations du lot : toutes les données sont affichées
 * automatiquement (commande, tailles, restes à couper, table, matelas,
 * plan, vérifications, anomalies). Aucun champ de saisie.
 */

function Info({ label, value }: { label: string; value: string }) {
  return (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Grid>
  );
}

export default function LotWorkflowInfo({
  lot,
  order = null,
  readiness,
  anomalies,
}: {
  lot: LotWorkflowRow;
  order?: OrderRow | null;
  readiness: LotCheckResult | null;
  anomalies: LotAnomalyDTO[];
}) {
  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Grid container spacing={2}>
          <Info label="Numéro du lot" value={lot.code} />
          <Info
            label="Commande"
            value={lot.orderCode ? `${lot.orderCode}` : '—'}
          />
          <Info
            label="Type de commande"
            value={
              lot.orderType === 'externe'
                ? `Externe — client : ${lot.clientNom ?? '—'}`
                : lot.orderType === 'interne'
                  ? 'Interne'
                  : '—'
            }
          />
          <Info label="Produit" value={lot.productNom} />
          <Info label="Couleur" value={lot.colorNom ?? '—'} />
          <Info label="Responsable" value={lot.responsableNom ?? '—'} />
          <Info label="Créé le" value={formatDateTime(lot.createdAt)} />
          <Info label="Démarré le" value={formatDateTime(lot.startedAt)} />
          <Info label="Terminé le" value={formatDateTime(lot.finishedAt)} />
          <Info
            label="Quantité prévue"
            value={`${lot.totalPlannedQty} pièce(s)`}
          />
          <Info
            label="Quantité coupée"
            value={`${lot.totalCutQty} pièce(s)`}
          />
          <Info
            label="Reste à couper"
            value={`${Math.max(0, lot.totalPlannedQty - lot.totalCutQty)} pièce(s)`}
          />
          <Info
            label="Table proposée"
            value={lot.coupeTableNom ?? '—'}
          />
          <Info
            label="Couches proposées"
            value={lot.proposedLayers ? String(lot.proposedLayers) : '—'}
          />
          <Info
            label="Longueur matelas proposée"
            value={
              lot.proposedMatelasLengthCm
                ? `${lot.proposedMatelasLengthCm} cm`
                : '—'
            }
          />
        </Grid>
        {lot.notes ? (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary">
              Notes : {lot.notes}
            </Typography>
          </>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Répartition par taille (prévu / coupé / reste)
        </Typography>
        <Table size="small" aria-label="Répartition par taille">
          <TableHead>
            <TableRow>
              <TableCell>Taille</TableCell>
              <TableCell align="right">Prévu</TableCell>
              <TableCell align="right">Coupé</TableCell>
              <TableCell align="right">Reste</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lot.sizes.map((size) => (
              <TableRow key={size.sizeId}>
                <TableCell>{size.sizeNom}</TableCell>
                <TableCell align="right">{size.plannedQty}</TableCell>
                <TableCell align="right">{size.cutQty}</TableCell>
                <TableCell align="right">
                  {Math.max(0, size.plannedQty - size.cutQty)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {order ? (
          <Typography variant="caption" color="text.secondary">
            Commande {order.code} — total commandé {order.totalQty}, déjà
            coupé {order.totalCut}.
          </Typography>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Vérifications automatiques
        </Typography>
        {readiness === null ? (
          <Typography variant="body2" color="text.secondary">
            Non encore exécutées.
          </Typography>
        ) : readiness.ok && readiness.warnings.length === 0 ? (
          <Alert severity="success">Prêt — aucune anomalie détectée.</Alert>
        ) : (
          <Stack spacing={1}>
            {readiness.blockers.map((blocker) => (
              <Alert key={blocker} severity="error">
                {blocker}
              </Alert>
            ))}
            {readiness.warnings.map((warning) => (
              <Alert key={warning} severity="warning">
                {warning}
              </Alert>
            ))}
            {readiness.ok ? (
              <Alert severity="success">
                Prêt — vérifications bloquantes passées.
              </Alert>
            ) : (
              <Alert severity="error">Bloqué — résolvez les problèmes ci-dessus.</Alert>
            )}
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Anomalies déclarées
        </Typography>
        {anomalies.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aucune anomalie.
          </Typography>
        ) : (
          anomalies.map((anomaly) => (
            <Typography key={anomaly.id} variant="body2">
              {formatDateTime(anomaly.createdAt)} —{' '}
              {ANOMALY_TYPE_LABELS[anomaly.type] ?? anomaly.type}
              {anomaly.sizeNom ? ` (taille ${anomaly.sizeNom})` : ''}
              {anomaly.qty > 0 ? ` — ${anomaly.qty} pièce(s)` : ''}
              {anomaly.motif ? ` — ${anomaly.motif}` : ''}
            </Typography>
          ))
        )}
      </Paper>
    </Stack>
  );
}
